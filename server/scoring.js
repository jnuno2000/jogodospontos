'use strict';

/**
 * Motor de pontuacao do "Jogo dos Pontos" do Eurosport Portugal.
 *
 * Regras (estilo golfe -> ganha quem tem MENOS pontos):
 *  - A pontuacao de uma aposta = posicao final do ciclista na etapa (7o = 7 pontos).
 *  - Bonus de -50 pontos por acertar no vencedor da etapa (posicao 1 -> 1 + (-50) = -49).
 *  - Penalizacao (sem aposta / aposta invalida / ciclista abandonou / sem classificacao):
 *      pontuacao do PIOR jogador valido da etapa + margem (default 50).
 *  - Classificacao geral = soma dos pontos; menor primeiro.
 *  - Desempate: mais vitorias de etapa (ciclista apostado 1o), depois mais 2os lugares, etc.
 *
 * Todas as funcoes sao puras (nao tocam na base de dados) para serem faceis de testar.
 */

const DEFAULT_SETTINGS = {
  winnerBonus: -50, // aplicado quando o ciclista apostado vence a etapa (posicao 1)
  penaltyMargin: 50, // pior jogador valido + esta margem
  repeatLimit: 2, // quantas vezes um jogador pode repetir o mesmo ciclista em toda a prova
  weekRanges: [
    [1, 9],
    [10, 15],
    [16, 21],
  ],
};

/** Devolve o indice (1-based) da semana a que pertence uma etapa. */
function weekOfStage(stageNumber, weekRanges = DEFAULT_SETTINGS.weekRanges) {
  for (let i = 0; i < weekRanges.length; i++) {
    const [lo, hi] = weekRanges[i];
    if (stageNumber >= lo && stageNumber <= hi) return i + 1;
  }
  return null;
}

/**
 * Pontua uma etapa.
 *
 * @param {Object} input
 * @param {Array<{playerId:*}>} input.players - todos os jogadores do jogo.
 * @param {Array<{playerId:*, riderId:*}>} input.bets - apostas colocadas nesta etapa.
 * @param {Array<{riderId:*, position:number}>} input.results - ordem de chegada.
 * @param {Iterable<*>} [input.abandonedRiderIds] - ciclistas que abandonaram.
 * @param {Object} [input.settings]
 * @returns {{scores:Array, worstValid:(number|null), penalty:number}}
 *   scores: [{ playerId, riderId, position, points, reason, isStageWin }]
 *   reason: 'ok' | 'no_bet' | 'abandoned' | 'no_position'
 */
function scoreStage(input) {
  const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
  const players = input.players || [];
  const bets = input.bets || [];
  const results = input.results || [];
  const abandoned = new Set(input.abandonedRiderIds || []);

  const betByPlayer = new Map();
  for (const b of bets) betByPlayer.set(String(b.playerId), b.riderId);

  const positionByRider = new Map();
  for (const r of results) positionByRider.set(String(r.riderId), r.position);

  // 1o passo: pontuar apostas validas e identificar penalizacoes pendentes.
  const scores = [];
  let worstValid = null;

  for (const p of players) {
    const pid = String(p.playerId ?? p.id);
    const riderId = betByPlayer.get(pid);

    if (riderId === undefined || riderId === null) {
      scores.push({ playerId: p.playerId ?? p.id, riderId: null, position: null, points: null, reason: 'no_bet', isStageWin: false });
      continue;
    }
    if (abandoned.has(riderId) || abandoned.has(String(riderId))) {
      scores.push({ playerId: p.playerId ?? p.id, riderId, position: null, points: null, reason: 'abandoned', isStageWin: false });
      continue;
    }
    const position = positionByRider.get(String(riderId));
    if (position === undefined || position === null) {
      scores.push({ playerId: p.playerId ?? p.id, riderId, position: null, points: null, reason: 'no_position', isStageWin: false });
      continue;
    }

    let points = position;
    const isStageWin = position === 1;
    if (isStageWin) points += settings.winnerBonus;

    if (worstValid === null || points > worstValid) worstValid = points;
    scores.push({ playerId: p.playerId ?? p.id, riderId, position, points, reason: 'ok', isStageWin });
  }

  // 2o passo: resolver penalizacoes (dependem do pior jogador valido).
  const penalty = (worstValid === null ? 0 : worstValid) + settings.penaltyMargin;
  for (const s of scores) {
    if (s.reason !== 'ok') s.points = penalty;
  }

  return { scores, worstValid, penalty };
}

/**
 * Calcula a classificacao geral a partir do historico de pontuacoes por jogador.
 *
 * @param {Array<{playerId:*, name?:string, entries:Array<{points:number, position:(number|null), reason:string}>}>} playerHistories
 * @returns {Array} ordenada (melhor primeiro) com { playerId, name, total, wins, positionCounts, rank }
 */
function computeStandings(playerHistories) {
  const rows = playerHistories.map((ph) => {
    let total = 0;
    const positionCounts = {}; // posicao -> nº de vezes (apenas apostas validas)
    for (const e of ph.entries || []) {
      if (typeof e.points === 'number') total += e.points;
      if (e.reason === 'ok' && typeof e.position === 'number') {
        positionCounts[e.position] = (positionCounts[e.position] || 0) + 1;
      }
    }
    return {
      playerId: ph.playerId,
      name: ph.name,
      total,
      wins: positionCounts[1] || 0,
      positionCounts,
      stagesPlayed: (ph.entries || []).filter((e) => typeof e.points === 'number').length,
    };
  });

  rows.sort((a, b) => compareStandings(a, b));

  // atribuir rank (com empates a partilharem posicao)
  let rank = 0;
  let prev = null;
  rows.forEach((row, idx) => {
    if (prev === null || compareStandings(prev, row) !== 0) rank = idx + 1;
    row.rank = rank;
    prev = row;
  });

  return rows;
}

/** Ordenacao: menor total primeiro; desempate por mais 1os, depois mais 2os, etc. */
function compareStandings(a, b) {
  if (a.total !== b.total) return a.total - b.total;
  // procurar a primeira posicao onde diferem (1o, 2o, 3o, ...)
  const maxPos = Math.max(
    ...Object.keys(a.positionCounts).map(Number),
    ...Object.keys(b.positionCounts).map(Number),
    0
  );
  for (let pos = 1; pos <= maxPos; pos++) {
    const ca = a.positionCounts[pos] || 0;
    const cb = b.positionCounts[pos] || 0;
    if (ca !== cb) return cb - ca; // mais lugares nessa posicao = melhor
  }
  return 0;
}

module.exports = {
  DEFAULT_SETTINGS,
  weekOfStage,
  scoreStage,
  computeStandings,
  compareStandings,
};
