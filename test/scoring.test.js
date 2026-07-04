'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreStage, computeStandings, weekOfStage } = require('../server/scoring');

function byPlayer(scores) {
  const m = {};
  for (const s of scores) m[s.playerId] = s;
  return m;
}

test('pontuacao = posicao final do ciclista (estilo golfe)', () => {
  const { scores } = scoreStage({
    players: [{ playerId: 'A' }, { playerId: 'B' }],
    bets: [
      { playerId: 'A', riderId: 'r7' },
      { playerId: 'B', riderId: 'r3' },
    ],
    results: [
      { riderId: 'r3', position: 3 },
      { riderId: 'r7', position: 7 },
    ],
  });
  const m = byPlayer(scores);
  assert.equal(m.A.points, 7);
  assert.equal(m.B.points, 3);
  assert.equal(m.A.reason, 'ok');
});

test('bonus de -50 por acertar no vencedor da etapa', () => {
  const { scores } = scoreStage({
    players: [{ playerId: 'A' }],
    bets: [{ playerId: 'A', riderId: 'win' }],
    results: [{ riderId: 'win', position: 1 }],
  });
  const m = byPlayer(scores);
  assert.equal(m.A.points, 1 - 50); // -49
  assert.equal(m.A.isStageWin, true);
});

test('penalizacao = pior jogador valido + 50 (sem aposta)', () => {
  const { scores, penalty } = scoreStage({
    players: [{ playerId: 'A' }, { playerId: 'B' }, { playerId: 'C' }],
    bets: [
      { playerId: 'A', riderId: 'r5' },
      { playerId: 'B', riderId: 'r20' },
      // C nao apostou
    ],
    results: [
      { riderId: 'r5', position: 5 },
      { riderId: 'r20', position: 20 },
    ],
  });
  const m = byPlayer(scores);
  assert.equal(penalty, 20 + 50); // pior valido (20) + 50
  assert.equal(m.C.points, 70);
  assert.equal(m.C.reason, 'no_bet');
});

test('ciclista que abandonou -> penalizacao', () => {
  const { scores } = scoreStage({
    players: [{ playerId: 'A' }, { playerId: 'B' }],
    bets: [
      { playerId: 'A', riderId: 'r5' },
      { playerId: 'B', riderId: 'dnf' },
    ],
    results: [{ riderId: 'r5', position: 5 }],
    abandonedRiderIds: ['dnf'],
  });
  const m = byPlayer(scores);
  assert.equal(m.B.reason, 'abandoned');
  assert.equal(m.B.points, 5 + 50);
});

test('ciclista sem classificacao registada -> reason no_position', () => {
  const { scores } = scoreStage({
    players: [{ playerId: 'A' }, { playerId: 'B' }],
    bets: [
      { playerId: 'A', riderId: 'r5' },
      { playerId: 'B', riderId: 'unknown' },
    ],
    results: [{ riderId: 'r5', position: 5 }],
  });
  const m = byPlayer(scores);
  assert.equal(m.B.reason, 'no_position');
  assert.equal(m.B.points, 5 + 50);
});

test('todos falham -> penalizacao usa base 0 + margem', () => {
  const { scores, penalty } = scoreStage({
    players: [{ playerId: 'A' }],
    bets: [],
    results: [],
  });
  assert.equal(penalty, 50);
  assert.equal(scores[0].points, 50);
});

test('classificacao geral: soma dos pontos, menor primeiro', () => {
  const standings = computeStandings([
    { playerId: 'A', name: 'Ana', entries: [{ points: 7, position: 7, reason: 'ok' }, { points: 3, position: 3, reason: 'ok' }] },
    { playerId: 'B', name: 'Bruno', entries: [{ points: 1, position: 1, reason: 'ok' }, { points: 2, position: 2, reason: 'ok' }] },
  ]);
  assert.equal(standings[0].playerId, 'B'); // 3 < 10
  assert.equal(standings[0].total, 3);
  assert.equal(standings[1].total, 10);
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[1].rank, 2);
});

test('desempate por mais vitorias de etapa, depois 2os lugares', () => {
  // Ambos com total 10, mas A tem uma vitoria (posicao 1)
  const standings = computeStandings([
    { playerId: 'A', name: 'A', entries: [{ points: 1, position: 1, reason: 'ok' }, { points: 9, position: 9, reason: 'ok' }] },
    { playerId: 'B', name: 'B', entries: [{ points: 5, position: 5, reason: 'ok' }, { points: 5, position: 5, reason: 'ok' }] },
  ]);
  assert.equal(standings[0].total, 10);
  assert.equal(standings[1].total, 10);
  assert.equal(standings[0].playerId, 'A'); // desempate: 1 vitoria vs 0
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[1].rank, 2);
});

test('empate total: mesmo total sem criterio de desempate partilha rank', () => {
  const standings = computeStandings([
    { playerId: 'A', name: 'A', entries: [{ points: 5, position: 5, reason: 'ok' }] },
    { playerId: 'B', name: 'B', entries: [{ points: 5, position: 5, reason: 'ok' }] },
  ]);
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[1].rank, 1); // empate perfeito
});

test('weekOfStage mapeia etapas para semanas', () => {
  assert.equal(weekOfStage(1), 1);
  assert.equal(weekOfStage(9), 1);
  assert.equal(weekOfStage(10), 2);
  assert.equal(weekOfStage(15), 2);
  assert.equal(weekOfStage(16), 3);
  assert.equal(weekOfStage(21), 3);
});
