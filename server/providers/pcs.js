'use strict';

/**
 * Adapter para o ProCyclingStats (PCS).
 *
 * O PCS bloqueia pedidos HTTP simples (responde 403 a curl/fetch), por isso
 * usamos o Playwright + Chromium (ja instalados no ambiente) para renderizar a
 * pagina como um browser real e extrair as tabelas. E BEST-EFFORT: se o PCS
 * bloquear, mudar de estrutura, ou o Playwright nao estiver instalado, as
 * funcoes lancam um erro e a app recorre ao caminho manual.
 */

const BASE = 'https://www.procyclingstats.com';

let _chromium = null;
function getChromium() {
  if (_chromium === null) {
    try {
      _chromium = require('playwright').chromium;
    } catch (e) {
      _chromium = false;
    }
  }
  if (!_chromium) {
    const err = new Error('Playwright nao esta instalado; usa a introducao manual.');
    err.code = 'NO_PLAYWRIGHT';
    throw err;
  }
  return _chromium;
}

async function withPage(fn) {
  const chromium = getChromium();
  const launchOpts = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      locale: 'pt-PT',
    });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** Extrai linhas de uma tabela HTML como matriz de texto das celulas. */
async function tableRows(page, selector) {
  return page.$$eval(selector + ' tbody tr', (trs) =>
    trs.map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())
    )
  );
}

/**
 * Startlist de uma edicao. `raceSlug` p.ex. 'tour-de-france'.
 * Devolve [{ name, team, bib, pcs_id }].
 */
async function getStartlist(raceSlug, year) {
  const url = `${BASE}/race/${raceSlug}/${year}/startlist`;
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // A startlist do PCS agrupa por equipa: cada equipa tem um <li> com <b> nome
    // da equipa e uma lista de corredores <a href="/rider/...">.
    const riders = await page.$$eval('ul.startlist_v4 li, .team', (nodes) => {
      const out = [];
      for (const node of nodes) {
        const teamEl = node.querySelector('a.team, .teamname, b');
        const team = teamEl ? teamEl.textContent.trim() : null;
        const links = node.querySelectorAll('a[href^="rider/"], a[href*="/rider/"]');
        links.forEach((a) => {
          const name = a.textContent.trim();
          const href = a.getAttribute('href') || '';
          const m = href.match(/rider\/([^/?#]+)/);
          if (name) out.push({ name, team, pcs_id: m ? m[1] : null, bib: null });
        });
      }
      return out;
    });
    if (!riders.length) {
      const err = new Error('Nao foi possivel ler a startlist do PCS (estrutura mudou ou pagina bloqueada).');
      err.code = 'PARSE_FAILED';
      throw err;
    }
    // remover duplicados por nome
    const seen = new Set();
    return riders.filter((r) => {
      const k = r.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
}

/**
 * Resultado de uma etapa. Devolve [{ position, name, team, pcs_id }] ordenado.
 */
async function getStageResult(raceSlug, year, stageNumber) {
  const url = `${BASE}/race/${raceSlug}/${year}/stage-${stageNumber}`;
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const rows = await page.$$eval('table.results tbody tr', (trs) =>
      trs.map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim());
        const link = tr.querySelector('a[href*="/rider/"]');
        const href = link ? link.getAttribute('href') || '' : '';
        const m = href.match(/rider\/([^/?#]+)/);
        const name = link ? link.textContent.trim() : '';
        return { cells, name, pcs_id: m ? m[1] : null };
      })
    );
    const out = [];
    let pos = 0;
    for (const r of rows) {
      if (!r.name) continue;
      // a 1a celula costuma ser a posicao ("1", "2", ... ou "DNF")
      const rankRaw = (r.cells[0] || '').replace(/\D/g, '');
      pos += 1;
      const position = rankRaw ? parseInt(rankRaw, 10) : pos;
      out.push({ position, name: r.name, pcs_id: r.pcs_id, team: null });
    }
    if (!out.length) {
      const err = new Error('Nao foi possivel ler os resultados do PCS (etapa sem resultados ou pagina bloqueada).');
      err.code = 'PARSE_FAILED';
      throw err;
    }
    return out;
  });
}

module.exports = { getStartlist, getStageResult, BASE };
