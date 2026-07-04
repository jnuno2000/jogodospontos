'use strict';

const db = require('../db');
const { GameError } = require('../service');

/** Middleware: carrega o jogo a partir de :code e coloca em req.game. */
function loadGame(req, res, next) {
  const game = db.getGameByCode(req.params.code);
  if (!game) return res.status(404).json({ error: 'Jogo nao encontrado.', code: 'GAME_NOT_FOUND' });
  req.game = game;
  next();
}

/** Verifica o token de admin (header x-admin-token ou body.adminToken). */
function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token') || req.body?.adminToken || req.query.adminToken;
  if (!token || token !== req.game.admin_token) {
    return res.status(403).json({ error: 'Precisas de ser o administrador do jogo.', code: 'NOT_ADMIN' });
  }
  next();
}

/** Resolve o jogador a partir do token (body.token ou query.token). */
function resolvePlayer(req) {
  const token = req.body?.token || req.query.token || req.get('x-player-token');
  if (!token) return null;
  const player = db.getPlayerByToken(token);
  if (!player || player.game_id !== req.game.id) return null;
  return player;
}

/** Versao publica do jogo (sem segredos). */
function publicGame(game) {
  return {
    room_code: game.room_code,
    name: game.name,
    settings: game.settings,
    created_at: game.created_at,
  };
}

function riderLite(r) {
  return r ? { id: r.id, name: r.name, team: r.team, bib: r.bib, status: r.status } : null;
}

function playerLite(p) {
  return p ? { id: p.id, name: p.name, color: p.color } : null;
}

/** Wrapper para apanhar erros async e mapear GameError -> resposta JSON. */
function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e instanceof GameError) {
        return res.status(e.status || 400).json({ error: e.message, code: e.code });
      }
      console.error(e);
      res.status(500).json({ error: 'Erro interno.', code: 'INTERNAL', detail: e.message });
    }
  };
}

module.exports = { loadGame, requireAdmin, resolvePlayer, publicGame, riderLite, playerLite, wrap };
