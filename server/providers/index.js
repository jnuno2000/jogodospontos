'use strict';

/**
 * Interface das fontes de dados. Por agora so o ProCyclingStats, mas o codigo
 * das rotas depende apenas destas funcoes, o que permite trocar/adicionar
 * fontes no futuro sem mexer no resto da app.
 */

const pcs = require('./pcs');

const DEFAULT_RACE = process.env.RACE_SLUG || 'tour-de-france';
const DEFAULT_YEAR = parseInt(process.env.RACE_YEAR || '2026', 10);

async function fetchStartlist({ race = DEFAULT_RACE, year = DEFAULT_YEAR } = {}) {
  return pcs.getStartlist(race, year);
}

async function fetchStageResult({ race = DEFAULT_RACE, year = DEFAULT_YEAR, stageNumber } = {}) {
  if (!stageNumber) throw new Error('stageNumber em falta');
  return pcs.getStageResult(race, year, stageNumber);
}

module.exports = { fetchStartlist, fetchStageResult, DEFAULT_RACE, DEFAULT_YEAR };
