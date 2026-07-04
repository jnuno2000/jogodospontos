'use strict';

const express = require('express');
const db = require('../db');
const service = require('../service');
const providers = require('../providers');
const { loadGame, requireAdmin, riderLite, wrap } = require('./helpers');

const router = express.Router();

// todas as rotas deste ficheiro carregam o jogo e exigem admin
router.use('/games/:code/admin', loadGame, requireAdmin);

// --- Importar startlist (manual) ---
router.post(
  '/games/:code/admin/startlist',
  wrap(async (req, res) => {
    const riders = Array.isArray(req.body?.riders) ? req.body.riders : [];
    if (!riders.length) return res.status(400).json({ error: 'Lista de ciclistas vazia.', code: 'NO_RIDERS' });
    const n = db.upsertRiders(req.game.id, riders);
    res.json({ ok: true, imported: n, riders: db.getRiders(req.game.id).map(riderLite) });
  })
);

// --- Buscar startlist automaticamente ao PCS (nao grava; devolve para confirmar) ---
router.post(
  '/games/:code/admin/fetch-startlist',
  wrap(async (req, res) => {
    try {
      const riders = await providers.fetchStartlist({});
      res.json({ ok: true, riders });
    } catch (e) {
      res.status(502).json({ error: 'Nao foi possivel obter a startlist automaticamente. Usa a introducao manual.', code: e.code || 'FETCH_FAILED', detail: e.message });
    }
  })
);

// --- Bloquear / reabrir etapa ---
router.post(
  '/games/:code/admin/stages/:number/lock',
  wrap(async (req, res) => {
    const stage = db.getStage(req.game.id, parseInt(req.params.number, 10));
    if (!stage) return res.status(404).json({ error: 'Etapa nao encontrada.', code: 'STAGE_NOT_FOUND' });
    const status = req.body?.reopen ? 'open' : 'locked';
    db.setStageStatus(stage.id, status);
    res.json({ ok: true, status });
  })
);

// --- Buscar resultados da etapa ao PCS (nao grava; devolve para confirmar) ---
router.post(
  '/games/:code/admin/stages/:number/fetch-results',
  wrap(async (req, res) => {
    const n = parseInt(req.params.number, 10);
    try {
      const results = await providers.fetchStageResult({ stageNumber: n });
      res.json({ ok: true, results });
    } catch (e) {
      res.status(502).json({ error: 'Nao foi possivel obter os resultados automaticamente. Introduz manualmente.', code: e.code || 'FETCH_FAILED', detail: e.message });
    }
  })
);

// --- Gravar resultados + pontuar etapa ---
router.post(
  '/games/:code/admin/stages/:number/results',
  wrap(async (req, res) => {
    const rows = Array.isArray(req.body?.results) ? req.body.results : [];
    if (!rows.length) return res.status(400).json({ error: 'Sem resultados para gravar.', code: 'NO_RESULTS' });
    const out = service.saveResults(req.game, parseInt(req.params.number, 10), rows);
    res.json({ ok: true, penalty: out.penalty, stage: out.stage });
  })
);

// --- Repontuar etapa (sem alterar resultados) ---
router.post(
  '/games/:code/admin/stages/:number/rescore',
  wrap(async (req, res) => {
    const out = service.scoreAndSave(req.game, parseInt(req.params.number, 10));
    res.json({ ok: true, penalty: out.penalty });
  })
);

// --- Marcar abandono / reativar ciclista (repontua etapas afetadas) ---
router.post(
  '/games/:code/admin/riders/:id/status',
  wrap(async (req, res) => {
    const rider = db.getRiderById(parseInt(req.params.id, 10));
    if (!rider || rider.game_id !== req.game.id) return res.status(404).json({ error: 'Ciclista nao encontrado.', code: 'RIDER_NOT_FOUND' });
    const status = req.body?.status === 'abandoned' ? 'abandoned' : 'active';
    db.setRiderStatus(rider.id, status);
    service.rescoreAll(req.game); // abandono afeta a pontuacao das etapas
    res.json({ ok: true, status });
  })
);

// --- Editar definicoes do jogo ---
router.put(
  '/games/:code/admin/settings',
  wrap(async (req, res) => {
    const patch = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
    const merged = { ...req.game.settings, ...patch };
    const game = db.updateGameSettings(req.game.id, merged);
    service.rescoreAll(game); // mudanca de regras afeta pontuacoes
    res.json({ ok: true, settings: game.settings });
  })
);

module.exports = router;
