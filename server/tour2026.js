'use strict';

/**
 * Calendario oficial do Tour de France 2026 (4-26 de julho, 21 etapas).
 * Fonte: Wikipedia "2026 Tour de France".
 *
 * `week` segue a divisao usada no jogo (semana 1: etapas 1-9, 2: 10-15, 3: 16-21).
 * `deadlineHour` (hora de Portugal continental) e usado para calcular o momento
 * a partir do qual as apostas ficam bloqueadas nesse dia.
 */

const STAGES = [
  { number: 1, date: '2026-07-04', name: 'Barcelona (Contrarrelógio por Equipas)', type: 'ttt' },
  { number: 2, date: '2026-07-05', name: 'Tarragona → Barcelona', type: 'hilly' },
  { number: 3, date: '2026-07-06', name: 'Granollers → Les Angles', type: 'mountain' },
  { number: 4, date: '2026-07-07', name: 'Carcassonne → Foix', type: 'hilly' },
  { number: 5, date: '2026-07-08', name: 'Lannemezan → Pau', type: 'flat' },
  { number: 6, date: '2026-07-09', name: 'Pau → Gavarnie-Gèdre', type: 'mountain' },
  { number: 7, date: '2026-07-10', name: 'Hagetmau → Bordeaux', type: 'flat' },
  { number: 8, date: '2026-07-11', name: 'Périgueux → Bergerac', type: 'flat' },
  { number: 9, date: '2026-07-12', name: 'Malemort → Ussel', type: 'hilly' },
  // 13 jul: dia de descanso (Cantal)
  { number: 10, date: '2026-07-14', name: 'Aurillac → Le Lioran', type: 'mountain' },
  { number: 11, date: '2026-07-15', name: 'Vichy → Nevers', type: 'flat' },
  { number: 12, date: '2026-07-16', name: 'Magny-Cours → Chalon-sur-Saône', type: 'flat' },
  { number: 13, date: '2026-07-17', name: 'Dole → Belfort', type: 'hilly' },
  { number: 14, date: '2026-07-18', name: 'Mulhouse → Le Markstein/Fellering', type: 'mountain' },
  { number: 15, date: '2026-07-19', name: 'Champagnole → Plateau de Solaison', type: 'mountain' },
  // 20 jul: dia de descanso (Haute-Savoie)
  { number: 16, date: '2026-07-21', name: 'Évian-les-Bains → Thonon-les-Bains (CRI)', type: 'itt' },
  { number: 17, date: '2026-07-22', name: 'Chambéry → Voiron', type: 'flat' },
  { number: 18, date: '2026-07-23', name: 'Voiron → Orcières-Merlette', type: 'mountain' },
  { number: 19, date: '2026-07-24', name: "Gap → Alpe d'Huez", type: 'mountain' },
  { number: 20, date: '2026-07-25', name: "Le Bourg-d'Oisans → Alpe d'Huez", type: 'mountain' },
  { number: 21, date: '2026-07-26', name: 'Thoiry → Paris (Champs-Élysées)', type: 'flat' },
];

const TYPE_LABELS = {
  flat: 'Plana',
  hilly: 'Acidentada',
  mountain: 'Montanha',
  itt: 'Contrarrelógio Individual',
  ttt: 'Contrarrelógio Equipas',
};

/** Semana do jogo a que pertence a etapa (1, 2 ou 3). */
function weekForStage(number) {
  if (number <= 9) return 1;
  if (number <= 15) return 2;
  return 3;
}

/**
 * Constroi a deadline (ISO) de uma etapa a partir da data e de uma hora local.
 * Portugal continental (Europe/Lisbon) esta em UTC+1 no verao (julho).
 */
function deadlineFor(dateStr, hour = 13) {
  const hh = String(hour).padStart(2, '0');
  // Verao em Portugal continental = UTC+1
  return `${dateStr}T${hh}:00:00+01:00`;
}

/** Devolve as 21 etapas com semana e deadline calculadas, prontas para o seed. */
function buildStages(deadlineHour = 13) {
  return STAGES.map((s) => ({
    number: s.number,
    date: s.date,
    name: s.name,
    type: s.type,
    typeLabel: TYPE_LABELS[s.type] || s.type,
    week: weekForStage(s.number),
    deadline: deadlineFor(s.date, deadlineHour),
  }));
}

module.exports = { STAGES, TYPE_LABELS, weekForStage, deadlineFor, buildStages };
