'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { buildStages } = require('./tour2026');
const { DEFAULT_SETTINGS } = require('./scoring');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'jogo.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code    TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  admin_token  TEXT NOT NULL,
  settings     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,
  join_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, name)
);

CREATE TABLE IF NOT EXISTS stages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  number    INTEGER NOT NULL,
  name      TEXT NOT NULL,
  type      TEXT,
  date      TEXT,
  deadline  TEXT,
  week      INTEGER,
  status    TEXT NOT NULL DEFAULT 'open',   -- open | locked | scored
  UNIQUE(game_id, number)
);

CREATE TABLE IF NOT EXISTS riders (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  pcs_id    TEXT,
  name      TEXT NOT NULL,
  team      TEXT,
  bib       INTEGER,
  status    TEXT NOT NULL DEFAULT 'active', -- active | abandoned
  UNIQUE(game_id, name)
);

CREATE TABLE IF NOT EXISTS bets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id    INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rider_id    INTEGER NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(stage_id, player_id)
);

CREATE TABLE IF NOT EXISTS stage_results (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id  INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  rider_id  INTEGER NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  UNIQUE(stage_id, rider_id)
);

CREATE TABLE IF NOT EXISTS stage_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id     INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points       INTEGER,
  position     INTEGER,
  reason       TEXT,
  is_stage_win INTEGER NOT NULL DEFAULT 0,
  UNIQUE(stage_id, player_id)
);
`);

function token(n = 24) {
  return crypto.randomBytes(n).toString('base64url');
}

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem caracteres ambiguos
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

// ---------- Jogos ----------

function createGame(name, settingsOverride = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...settingsOverride };
  const admin_token = token();
  let code;
  // garantir codigo unico
  for (let attempt = 0; attempt < 10; attempt++) {
    code = roomCode();
    const exists = db.prepare('SELECT 1 FROM games WHERE room_code = ?').get(code);
    if (!exists) break;
  }
  const info = db
    .prepare('INSERT INTO games (room_code, name, admin_token, settings) VALUES (?, ?, ?, ?)')
    .run(code, name, admin_token, JSON.stringify(settings));
  const gameId = info.lastInsertRowid;

  // semear as 21 etapas do Tour 2026
  const insertStage = db.prepare(
    'INSERT INTO stages (game_id, number, name, type, date, deadline, week, status) VALUES (?,?,?,?,?,?,?,?)'
  );
  const stages = buildStages(settings.deadlineHour || 13);
  const seed = db.transaction((rows) => {
    for (const s of rows) {
      insertStage.run(gameId, s.number, s.name, s.type, s.date, s.deadline, s.week, 'open');
    }
  });
  seed(stages);

  return getGameById(gameId);
}

function getGameById(id) {
  const g = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  return g ? hydrateGame(g) : null;
}

function getGameByCode(code) {
  const g = db.prepare('SELECT * FROM games WHERE room_code = ?').get(String(code || '').toUpperCase());
  return g ? hydrateGame(g) : null;
}

function hydrateGame(g) {
  return { ...g, settings: JSON.parse(g.settings || '{}') };
}

function updateGameSettings(gameId, settings) {
  db.prepare('UPDATE games SET settings = ? WHERE id = ?').run(JSON.stringify(settings), gameId);
  return getGameById(gameId);
}

// ---------- Jogadores ----------

const PLAYER_COLORS = ['#e6194B', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'];

function addPlayer(gameId, name) {
  const count = db.prepare('SELECT COUNT(*) c FROM players WHERE game_id = ?').get(gameId).c;
  const color = PLAYER_COLORS[count % PLAYER_COLORS.length];
  const join_token = token();
  const info = db
    .prepare('INSERT INTO players (game_id, name, color, join_token) VALUES (?,?,?,?)')
    .run(gameId, name.trim(), color, join_token);
  return db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid);
}

function getPlayers(gameId) {
  return db.prepare('SELECT * FROM players WHERE game_id = ? ORDER BY id').all(gameId);
}

function getPlayerByToken(joinToken) {
  return db.prepare('SELECT * FROM players WHERE join_token = ?').get(joinToken);
}

// ---------- Etapas ----------

function getStages(gameId) {
  return db.prepare('SELECT * FROM stages WHERE game_id = ? ORDER BY number').all(gameId);
}

function getStage(gameId, number) {
  return db.prepare('SELECT * FROM stages WHERE game_id = ? AND number = ?').get(gameId, number);
}

function getStageById(stageId) {
  return db.prepare('SELECT * FROM stages WHERE id = ?').get(stageId);
}

function setStageStatus(stageId, status) {
  db.prepare('UPDATE stages SET status = ? WHERE id = ?').run(status, stageId);
}

// ---------- Ciclistas ----------

function getRiders(gameId) {
  return db.prepare('SELECT * FROM riders WHERE game_id = ? ORDER BY name').all(gameId);
}

function getRiderById(riderId) {
  return db.prepare('SELECT * FROM riders WHERE id = ?').get(riderId);
}

function getRiderByName(gameId, name) {
  return db
    .prepare('SELECT * FROM riders WHERE game_id = ? AND lower(name) = lower(?)')
    .get(gameId, String(name || '').trim());
}

/** Insere/atualiza ciclistas da startlist. `riders` = [{name, team, bib, pcs_id}] */
function upsertRiders(gameId, riders) {
  const insert = db.prepare(
    `INSERT INTO riders (game_id, pcs_id, name, team, bib, status) VALUES (?,?,?,?,?, 'active')
     ON CONFLICT(game_id, name) DO UPDATE SET team = excluded.team, bib = excluded.bib, pcs_id = COALESCE(excluded.pcs_id, riders.pcs_id)`
  );
  const tx = db.transaction((rows) => {
    let n = 0;
    for (const r of rows) {
      if (!r.name || !String(r.name).trim()) continue;
      insert.run(gameId, r.pcs_id || null, String(r.name).trim(), r.team || null, r.bib || null);
      n++;
    }
    return n;
  });
  return tx(riders);
}

function setRiderStatus(riderId, status) {
  db.prepare('UPDATE riders SET status = ? WHERE id = ?').run(status, riderId);
}

// ---------- Apostas ----------

function getBet(stageId, playerId) {
  return db.prepare('SELECT * FROM bets WHERE stage_id = ? AND player_id = ?').get(stageId, playerId);
}

function getBetsForStage(stageId) {
  return db.prepare('SELECT * FROM bets WHERE stage_id = ?').all(stageId);
}

function getBetsForPlayer(playerId) {
  return db
    .prepare('SELECT b.*, s.number AS stage_number, s.week AS week FROM bets b JOIN stages s ON s.id = b.stage_id WHERE b.player_id = ?')
    .all(playerId);
}

function placeBet(stageId, playerId, riderId) {
  db.prepare(
    `INSERT INTO bets (stage_id, player_id, rider_id) VALUES (?,?,?)
     ON CONFLICT(stage_id, player_id) DO UPDATE SET rider_id = excluded.rider_id, created_at = datetime('now')`
  ).run(stageId, playerId, riderId);
  return getBet(stageId, playerId);
}

// ---------- Resultados ----------

function getResults(stageId) {
  return db
    .prepare('SELECT * FROM stage_results WHERE stage_id = ? ORDER BY position')
    .all(stageId);
}

/** Substitui os resultados de uma etapa. `results` = [{rider_id, position}] */
function replaceResults(stageId, results) {
  const del = db.prepare('DELETE FROM stage_results WHERE stage_id = ?');
  const ins = db.prepare('INSERT INTO stage_results (stage_id, rider_id, position) VALUES (?,?,?)');
  const tx = db.transaction((rows) => {
    del.run(stageId);
    for (const r of rows) ins.run(stageId, r.rider_id, r.position);
  });
  tx(results);
}

// ---------- Pontuacoes ----------

function replaceStageScores(stageId, scores) {
  const del = db.prepare('DELETE FROM stage_scores WHERE stage_id = ?');
  const ins = db.prepare(
    'INSERT INTO stage_scores (stage_id, player_id, points, position, reason, is_stage_win) VALUES (?,?,?,?,?,?)'
  );
  const tx = db.transaction((rows) => {
    del.run(stageId);
    for (const s of rows) {
      ins.run(stageId, s.playerId, s.points, s.position, s.reason, s.isStageWin ? 1 : 0);
    }
  });
  tx(scores);
}

function getStageScores(stageId) {
  return db.prepare('SELECT * FROM stage_scores WHERE stage_id = ?').all(stageId);
}

function getAllScores(gameId) {
  return db
    .prepare(
      `SELECT ss.*, s.number AS stage_number
       FROM stage_scores ss JOIN stages s ON s.id = ss.stage_id
       WHERE s.game_id = ?`
    )
    .all(gameId);
}

module.exports = {
  db,
  token,
  createGame,
  getGameById,
  getGameByCode,
  updateGameSettings,
  addPlayer,
  getPlayers,
  getPlayerByToken,
  getStages,
  getStage,
  getStageById,
  setStageStatus,
  getRiders,
  getRiderById,
  getRiderByName,
  upsertRiders,
  setRiderStatus,
  getBet,
  getBetsForStage,
  getBetsForPlayer,
  placeBet,
  getResults,
  replaceResults,
  replaceStageScores,
  getStageScores,
  getAllScores,
};
