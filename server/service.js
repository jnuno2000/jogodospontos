'use strict';

/**
 * Camada de servico: liga a base de dados ao motor de pontuacao.
 * Contem as regras do jogo que dependem de estado (validacao de apostas,
 * pontuacao de etapas, classificacao geral).
 */

const db = require('./db');
const { scoreStage, computeStandings, weekOfStage } = require('./scoring');

class GameError extends Error {
  constructor(message, code = 'BAD_REQUEST', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function isStageOpen(stage) {
  if (stage.status !== 'open') return false;
  if (stage.deadline) {
    return Date.now() < new Date(stage.deadline).getTime();
  }
  return true;
}

/**
 * Valida uma aposta segundo as regras do jogo. Lanca GameError se invalida.
 * Devolve { stage, rider } se valida.
 */
function validateBet(game, stage, player, rider) {
  const settings = game.settings || {};

  if (!isStageOpen(stage)) {
    throw new GameError('As apostas para esta etapa estao fechadas.', 'STAGE_CLOSED');
  }
  if (!rider) throw new GameError('Ciclista nao encontrado.', 'RIDER_NOT_FOUND', 404);
  if (rider.status === 'abandoned') {
    throw new GameError('Esse ciclista ja abandonou a prova.', 'RIDER_ABANDONED');
  }

  // apostas anteriores do jogador
  const bets = db.getBetsForPlayer(player.id).filter((b) => b.stage_id !== stage.id);

  // 1) nao repetir o mesmo ciclista na mesma semana
  const weekRanges = settings.weekRanges;
  const thisWeek = stage.week || weekOfStage(stage.number, weekRanges);
  const sameRiderSameWeek = bets.some(
    (b) => b.rider_id === rider.id && (b.week || weekOfStage(b.stage_number, weekRanges)) === thisWeek
  );
  if (sameRiderSameWeek) {
    throw new GameError('Nao podes apostar no mesmo ciclista duas vezes na mesma semana.', 'REPEAT_SAME_WEEK');
  }

  // 2) limite de repeticoes em toda a prova
  const limit = settings.repeatLimit || 2;
  const timesUsed = bets.filter((b) => b.rider_id === rider.id).length;
  if (timesUsed >= limit) {
    throw new GameError(`Ja usaste este ciclista ${limit} vez(es) — o maximo permitido.`, 'REPEAT_LIMIT');
  }

  return { stage, rider };
}

function placeBet(game, stageNumber, player, riderId) {
  const stage = db.getStage(game.id, stageNumber);
  if (!stage) throw new GameError('Etapa nao encontrada.', 'STAGE_NOT_FOUND', 404);
  const rider = db.getRiderById(riderId);
  if (!rider || rider.game_id !== game.id) throw new GameError('Ciclista nao encontrado.', 'RIDER_NOT_FOUND', 404);
  validateBet(game, stage, player, rider);
  return db.placeBet(stage.id, player.id, rider.id);
}

/**
 * Guarda os resultados de uma etapa. `rows` = [{ name?|riderId?, position }].
 * Cria ciclistas em falta (pelo nome) para permitir introducao manual livre.
 */
function saveResults(game, stageNumber, rows) {
  const stage = db.getStage(game.id, stageNumber);
  if (!stage) throw new GameError('Etapa nao encontrada.', 'STAGE_NOT_FOUND', 404);

  const resolved = [];
  const seen = new Set();
  for (const row of rows) {
    const position = parseInt(row.position, 10);
    if (!position || position < 1) continue;
    let rider = null;
    if (row.riderId) rider = db.getRiderById(row.riderId);
    else if (row.name) {
      rider = db.getRiderByName(game.id, row.name);
      if (!rider) {
        db.upsertRiders(game.id, [{ name: row.name, team: row.team || null, pcs_id: row.pcs_id || null }]);
        rider = db.getRiderByName(game.id, row.name);
      }
    }
    if (!rider) continue;
    if (seen.has(rider.id)) continue; // uma posicao por ciclista
    seen.add(rider.id);
    resolved.push({ rider_id: rider.id, position });
  }

  if (!resolved.length) throw new GameError('Nenhum resultado valido para gravar.', 'NO_RESULTS');

  db.replaceResults(stage.id, resolved);
  return scoreAndSave(game, stage.number);
}

/** Pontua a etapa a partir das apostas + resultados + abandonos, e grava. */
function scoreAndSave(game, stageNumber) {
  const stage = db.getStage(game.id, stageNumber);
  if (!stage) throw new GameError('Etapa nao encontrada.', 'STAGE_NOT_FOUND', 404);

  const players = db.getPlayers(game.id).map((p) => ({ playerId: p.id }));
  const bets = db.getBetsForStage(stage.id).map((b) => ({ playerId: b.player_id, riderId: b.rider_id }));
  const results = db.getResults(stage.id).map((r) => ({ riderId: r.rider_id, position: r.position }));
  const abandoned = db.getRiders(game.id).filter((r) => r.status === 'abandoned').map((r) => r.id);

  const { scores, penalty } = scoreStage({
    players,
    bets,
    results,
    abandonedRiderIds: abandoned,
    settings: game.settings,
  });

  db.replaceStageScores(stage.id, scores);
  db.setStageStatus(stage.id, 'scored');
  return { stage: db.getStageById(stage.id), scores, penalty };
}

/** Volta a pontuar todas as etapas que ja tem resultados (ex.: apos abandono). */
function rescoreAll(game) {
  const stages = db.getStages(game.id);
  for (const s of stages) {
    if (db.getResults(s.id).length > 0) scoreAndSave(game, s.number);
  }
}

/** Classificacao geral. */
function standings(game) {
  const players = db.getPlayers(game.id);
  const allScores = db.getAllScores(game.id);
  const byPlayer = new Map();
  for (const p of players) byPlayer.set(p.id, { playerId: p.id, name: p.name, color: p.color, entries: [] });
  for (const s of allScores) {
    const rec = byPlayer.get(s.player_id);
    if (rec) rec.entries.push({ points: s.points, position: s.position, reason: s.reason, stage_number: s.stage_number });
  }
  const rows = computeStandings(Array.from(byPlayer.values()));
  // reanexar cor
  const colorById = new Map(players.map((p) => [p.id, p.color]));
  for (const r of rows) r.color = colorById.get(r.playerId);
  return rows;
}

module.exports = {
  GameError,
  isStageOpen,
  validateBet,
  placeBet,
  saveResults,
  scoreAndSave,
  rescoreAll,
  standings,
};
