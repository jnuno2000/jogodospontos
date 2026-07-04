'use strict';

/**
 * Cria um jogo de demonstracao com jogadores, startlist e uma etapa ja pontuada.
 * Uso: DATA_DIR=./data node scripts/seed-demo.js
 */

const db = require('../server/db');
const service = require('../server/service');

const game = db.createGame('Demo — Tour com amigos');
console.log('Jogo criado:', game.room_code);
console.log('Link de admin: ?code=' + game.room_code + '&admin=' + game.admin_token);

const players = ['Ana', 'Bruno', 'Carla'].map((n) => db.addPlayer(game.id, n));

const riders = [
  ['Tadej Pogacar', 'UAE Team Emirates'],
  ['Jonas Vingegaard', 'Visma | Lease a Bike'],
  ['Remco Evenepoel', 'Soudal Quick-Step'],
  ['Primoz Roglic', 'Red Bull-BORA'],
  ['Jasper Philipsen', 'Alpecin-Deceuninck'],
  ['Mathieu van der Poel', 'Alpecin-Deceuninck'],
  ['Wout van Aert', 'Visma | Lease a Bike'],
  ['Biniam Girmay', 'Intermarche'],
];
db.upsertRiders(game.id, riders.map(([name, team]) => ({ name, team })));
const rid = (name) => db.getRiderByName(game.id, name).id;

// Etapa 5 (futura/aberta): cada jogador aposta
service.placeBet(game, 5, players[0], rid('Tadej Pogacar'));
service.placeBet(game, 5, players[1], rid('Jasper Philipsen'));
service.placeBet(game, 5, players[2], rid('Wout van Aert'));

// Pontuar a etapa 5 com um resultado ficticio
db.setStageStatus(db.getStage(game.id, 5).id, 'locked');
service.saveResults(game, 5, [
  { name: 'Tadej Pogacar', position: 1 },
  { name: 'Wout van Aert', position: 2 },
  { name: 'Jasper Philipsen', position: 3 },
]);

console.log('\nClassificacao:');
for (const s of service.standings(game)) {
  console.log(`  #${s.rank} ${s.name}: ${s.total} pts (vitorias: ${s.wins})`);
}
console.log('\nAbre a app e entra com o codigo', game.room_code);
