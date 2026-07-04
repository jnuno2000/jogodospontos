'use strict';

const express = require('express');
const db = require('../db');
const service = require('../service');
const { loadGame, resolvePlayer, publicGame, riderLite, playerLite, wrap } = require('./helpers');

const router = express.Router();

// --- Criar jogo ---
router.post(
  '/games',
  wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Da um nome ao jogo.', code: 'NO_NAME' });
    const settings = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
    const game = db.createGame(name, settings);
    // devolve o admin_token apenas a quem cria
    res.status(201).json({
      game: publicGame(game),
      adminToken: game.admin_token,
      adminUrl: `?code=${game.room_code}&admin=${game.admin_token}`,
    });
  })
);

// --- Entrar num jogo ---
router.post(
  '/games/:code/join',
  loadGame,
  wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Escreve o teu nome.', code: 'NO_NAME' });
    const existing = db.getPlayers(req.game.id).find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Ja existe um jogador com esse nome neste jogo.', code: 'NAME_TAKEN' });
    }
    const player = db.addPlayer(req.game.id, name);
    res.status(201).json({ player: playerLite(player), token: player.join_token });
  })
);

// --- Estado geral do jogo ---
router.get(
  '/games/:code',
  loadGame,
  wrap(async (req, res) => {
    const game = req.game;
    const players = db.getPlayers(game.id);
    const stages = db.getStages(game.id).map((s) => {
      const results = db.getResults(s.id);
      const bets = db.getBetsForStage(s.id);
      return {
        number: s.number,
        name: s.name,
        type: s.type,
        date: s.date,
        deadline: s.deadline,
        week: s.week,
        status: s.status,
        open: service.isStageOpen(s),
        hasResults: results.length > 0,
        betCount: bets.length,
      };
    });
    const firstOpen = stages.find((s) => s.open);
    const lastScored = [...stages].reverse().find((s) => s.status === 'scored');
    const currentStageNumber = firstOpen ? firstOpen.number : lastScored ? lastScored.number : 1;

    res.json({
      game: publicGame(game),
      players: players.map(playerLite),
      stages,
      ridersCount: db.getRiders(game.id).length,
      currentStageNumber,
    });
  })
);

// --- Startlist ---
router.get(
  '/games/:code/riders',
  loadGame,
  wrap(async (req, res) => {
    res.json({ riders: db.getRiders(req.game.id).map(riderLite) });
  })
);

// --- Detalhe de uma etapa ---
router.get(
  '/games/:code/stages/:number',
  loadGame,
  wrap(async (req, res) => {
    const stage = db.getStage(req.game.id, parseInt(req.params.number, 10));
    if (!stage) return res.status(404).json({ error: 'Etapa nao encontrada.', code: 'STAGE_NOT_FOUND' });

    const me = resolvePlayer(req);
    const open = service.isStageOpen(stage);
    const revealBets = !open; // so revela as escolhas dos outros quando fecha

    const players = db.getPlayers(req.game.id);
    const bets = db.getBetsForStage(stage.id);
    const betByPlayer = new Map(bets.map((b) => [b.player_id, b]));

    const betsView = players.map((p) => {
      const b = betByPlayer.get(p.id);
      const mine = me && me.id === p.id;
      const showRider = b && (revealBets || mine);
      return {
        player: playerLite(p),
        placed: !!b,
        rider: showRider ? riderLite(db.getRiderById(b.rider_id)) : null,
      };
    });

    const results = db.getResults(stage.id).map((r) => ({
      position: r.position,
      rider: riderLite(db.getRiderById(r.rider_id)),
    }));

    const scores = db.getStageScores(stage.id).map((s) => ({
      player: playerLite(players.find((p) => p.id === s.player_id)),
      points: s.points,
      position: s.position,
      reason: s.reason,
      isStageWin: !!s.is_stage_win,
    }));

    res.json({
      stage: {
        number: stage.number,
        name: stage.name,
        type: stage.type,
        date: stage.date,
        deadline: stage.deadline,
        week: stage.week,
        status: stage.status,
        open,
      },
      bets: betsView,
      results,
      scores: scores.sort((a, b) => (a.points ?? 1e9) - (b.points ?? 1e9)),
      revealBets,
    });
  })
);

// --- Colocar/alterar aposta ---
router.post(
  '/games/:code/stages/:number/bet',
  loadGame,
  wrap(async (req, res) => {
    const me = resolvePlayer(req);
    if (!me) return res.status(401).json({ error: 'Entra no jogo primeiro.', code: 'NO_PLAYER' });
    const riderId = parseInt(req.body?.riderId, 10);
    if (!riderId) return res.status(400).json({ error: 'Escolhe um ciclista.', code: 'NO_RIDER' });
    const bet = service.placeBet(req.game, parseInt(req.params.number, 10), me, riderId);
    res.json({ ok: true, bet: { stage_id: bet.stage_id, rider: riderLite(db.getRiderById(bet.rider_id)) } });
  })
);

// --- Info do proprio jogador (apostas + ciclistas usados) ---
router.get(
  '/games/:code/me',
  loadGame,
  wrap(async (req, res) => {
    const me = resolvePlayer(req);
    if (!me) return res.status(401).json({ error: 'Jogador nao identificado.', code: 'NO_PLAYER' });
    const bets = db.getBetsForPlayer(me.id).map((b) => ({
      stage_number: b.stage_number,
      week: b.week,
      rider: riderLite(db.getRiderById(b.rider_id)),
    }));
    // contagem de utilizacoes por ciclista
    const usage = {};
    for (const b of bets) {
      if (!b.rider) continue;
      usage[b.rider.id] = usage[b.rider.id] || { rider: b.rider, count: 0, weeks: [] };
      usage[b.rider.id].count++;
      usage[b.rider.id].weeks.push(b.week);
    }
    res.json({ player: playerLite(me), bets, usage: Object.values(usage) });
  })
);

// --- Classificacao geral ---
router.get(
  '/games/:code/standings',
  loadGame,
  wrap(async (req, res) => {
    res.json({ standings: service.standings(req.game) });
  })
);

module.exports = router;
