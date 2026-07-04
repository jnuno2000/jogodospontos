'use strict';

/* ---------------- Estado + armazenamento local ---------------- */
const LS_KEY = 'jdp:v1';
const Store = {
  data: { games: {}, lastCode: null },
  load() {
    try { this.data = JSON.parse(localStorage.getItem(LS_KEY)) || this.data; } catch {}
    if (!this.data.games) this.data.games = {};
    return this.data;
  },
  save() { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); },
  game(code) { return this.data.games[code] || (this.data.games[code] = {}); },
  set(code, patch) { Object.assign(this.game(code), patch); this.data.lastCode = code; this.save(); },
};

const App = {
  code: null,
  game: null,       // estado publico do jogo (do servidor)
  riders: [],
  tab: 'aposta',
  stageView: null,  // numero de etapa em detalhe (aba etapas)
  selectedRider: null,
  riderFilter: '',
  poll: null,
};

/* ---------------- API ---------------- */
async function api(path, { method = 'GET', body, admin, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const g = App.code ? Store.game(App.code) : {};
  if (admin && g.adminToken) headers['x-admin-token'] = g.adminToken;
  if (token && g.playerToken) headers['x-player-token'] = g.playerToken;
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Erro'); e.code = data.code; e.data = data; throw e; }
  return data;
}

/* ---------------- Utilidades UI ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
function fmtPts(p) { return p > 0 ? '+' + p : String(p); }
function typeLabel(t) { return ({ flat: 'Plana', hilly: 'Acidentada', mountain: 'Montanha', itt: 'CRI', ttt: 'CRE' })[t] || t; }
function reasonLabel(r) { return ({ no_bet: 'sem aposta', abandoned: 'abandonou', no_position: 'sem classificação' })[r] || ''; }

/* ---------------- Arranque / routing ---------------- */
function currentPlayer() { return App.code ? Store.game(App.code) : {}; }
function isAdmin() { return !!currentPlayer().adminToken; }
function hasJoined() { return !!currentPlayer().playerToken; }

async function boot() {
  Store.load();
  const url = new URL(location.href);
  const code = (url.searchParams.get('code') || '').toUpperCase();
  const admin = url.searchParams.get('admin');
  if (code) {
    if (admin) Store.set(code, { adminToken: admin });
    App.code = code;
    // limpar querystring sensivel
    history.replaceState({}, '', location.pathname + '?code=' + code);
  } else if (Store.data.lastCode) {
    App.code = Store.data.lastCode;
  }
  $('#brandHome').addEventListener('click', goHome);
  if (App.code) await enterGame(App.code); else renderHome();
}

function goHome() {
  stopPoll(); App.code = null; App.game = null;
  history.replaceState({}, '', location.pathname);
  renderHome();
}

/* ---------------- HOME ---------------- */
function renderHome() {
  renderTopbar();
  const view = $('#view'); view.innerHTML = '';
  view.append($('#tpl-home').content.cloneNode(true));
  $('#btnCreate').addEventListener('click', createGame);
  $('#btnJoin').addEventListener('click', joinGame);
  const last = Store.data.lastCode;
  if (last && Store.game(last).playerToken) {
    view.querySelector('.home').prepend(
      el('div', { class: 'panel', style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
        el('span', {}, `Continuar o jogo ${last} como ${Store.game(last).playerName || ''}`),
        el('button', { class: 'btn small primary', onclick: () => enterGame(last) }, 'Voltar ao jogo'),
      ])
    );
  }
}

async function createGame() {
  const name = $('#newGameName').value.trim();
  if (!name) return toast('Dá um nome ao jogo.', 'err');
  try {
    const r = await api('/games', { method: 'POST', body: { name } });
    const code = r.game.room_code;
    Store.set(code, { name, adminToken: r.adminToken });
    App.code = code;
    toast('Jogo criado! És o administrador.', 'ok');
    await enterGame(code);
  } catch (e) { toast(e.message, 'err'); }
}

async function joinGame(codeArg, nameArg) {
  const code = (codeArg || $('#joinCode').value).trim().toUpperCase();
  const name = (nameArg || $('#joinName').value).trim();
  if (!code) return toast('Escreve o código da sala.', 'err');
  if (!name) return toast('Escreve o teu nome.', 'err');
  try {
    const r = await api(`/games/${code}/join`, { method: 'POST', body: { name } });
    Store.set(code, { playerToken: r.token, playerName: r.player.name, playerId: r.player.id });
    App.code = code;
    toast(`Bem-vindo, ${r.player.name}!`, 'ok');
    await enterGame(code);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------- Entrar no jogo ---------------- */
async function enterGame(code) {
  App.code = code;
  try {
    await refresh();
  } catch (e) {
    toast('Não foi possível abrir o jogo: ' + e.message, 'err');
    return goHome();
  }
  if (!hasJoined() && !isAdmin()) { App.tab = 'aposta'; promptJoinInline(); }
  startPoll();
}

function promptJoinInline() {
  // se abriu por link sem ser jogador nem admin, pede o nome
  const name = prompt('Qual é o teu nome para entrar no jogo ' + App.code + '?');
  if (name && name.trim()) joinGame(App.code, name.trim());
}

async function refresh() {
  const [state, ridersRes] = await Promise.all([
    api(`/games/${App.code}`),
    api(`/games/${App.code}/riders`),
  ]);
  App.game = state;
  App.riders = ridersRes.riders;
  Store.set(App.code, { name: state.game.name });
  render();
}

function startPoll() {
  stopPoll();
  App.poll = setInterval(() => { refresh().catch(() => {}); }, 6000);
}
function stopPoll() { if (App.poll) clearInterval(App.poll); App.poll = null; }

/* ---------------- Render principal ---------------- */
function renderTopbar() {
  const right = $('#topbarRight'); right.innerHTML = '';
  if (!App.code || !App.game) return;
  right.append(el('span', { class: 'pill copy', title: 'Copiar link de convite', onclick: copyInvite }, `SALA ${App.code} ⧉`));
  const me = currentPlayer();
  if (me.playerName) right.append(el('span', { class: 'who' }, `👤 ${me.playerName}`));
  if (isAdmin()) right.append(el('span', { class: 'pill light' }, 'admin'));
}

function copyInvite() {
  const link = location.origin + location.pathname + '?code=' + App.code;
  navigator.clipboard?.writeText(link).then(
    () => toast('Link de convite copiado!', 'ok'),
    () => toast(link)
  );
}

function render() {
  renderTopbar();
  const view = $('#view'); view.innerHTML = '';
  if (!App.game) return;

  const tabs = [
    ['aposta', 'Aposta'],
    ['etapas', 'Etapas'],
    ['classificacao', 'Classificação'],
  ];
  if (isAdmin()) tabs.push(['admin', '⚙ Admin']);
  if (!tabs.find((t) => t[0] === App.tab)) App.tab = 'aposta';

  const tabbar = el('div', { class: 'tabs' });
  for (const [id, label] of tabs) {
    tabbar.append(el('div', { class: 'tab' + (App.tab === id ? ' active' : ''), onclick: () => { App.tab = id; render(); } }, label));
  }
  view.append(tabbar);

  if (App.tab === 'aposta') view.append(renderBetTab());
  else if (App.tab === 'etapas') view.append(renderStagesTab());
  else if (App.tab === 'classificacao') view.append(renderStandingsTab());
  else if (App.tab === 'admin') view.append(renderAdminTab());
}

/* ---------------- Aba APOSTA ---------------- */
function stageByNumber(n) { return App.game.stages.find((s) => s.number === n); }

function renderBetTab() {
  const wrap = el('div');
  if (App.game.ridersCount === 0) {
    wrap.append(el('div', { class: 'panel empty' }, isAdmin()
      ? 'Ainda não há startlist. Vai ao separador ⚙ Admin para importar os ciclistas.'
      : 'O administrador ainda não importou a lista de ciclistas. Aguarda um pouco.'));
    return wrap;
  }
  if (!hasJoined() && !isAdmin()) {
    wrap.append(el('div', { class: 'panel' }, [
      el('p', {}, 'Entra no jogo para poderes apostar.'),
      el('button', { class: 'btn primary small', onclick: promptJoinInline }, 'Entrar no jogo'),
    ]));
    return wrap;
  }

  // seletor de etapa (default: etapa atual)
  if (App.betStage == null) App.betStage = App.game.currentStageNumber;
  const stage = stageByNumber(App.betStage) || stageByNumber(App.game.currentStageNumber);

  const selector = el('select', { onchange: (e) => { App.betStage = +e.target.value; App.selectedRider = null; render(); } });
  for (const s of App.game.stages) {
    const lbl = `Etapa ${s.number} — ${s.name}` + (s.open ? '  · aberta' : s.status === 'scored' ? '  · terminada' : '  · fechada');
    selector.append(el('option', { value: s.number, ...(s.number === stage.number ? { selected: 'selected' } : {}) }, lbl));
  }

  const head = el('div', { class: 'panel' }, [
    el('div', { class: 'stage-head' }, [
      el('div', { style: 'display:flex;gap:12px;align-items:center' }, [
        el('span', { class: 'stage-num' }, String(stage.number)),
        el('div', {}, [
          el('div', { style: 'font-weight:800' }, stage.name),
          el('div', { style: 'color:var(--muted);font-size:13px' }, `Semana ${stage.week} · ${new Date(stage.date).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'long' })}`),
        ]),
      ]),
      el('span', { class: 'badge ' + stage.type }, typeLabel(stage.type)),
    ]),
    el('div', { style: 'margin-top:12px' }, selector),
    renderDeadline(stage),
  ]);
  wrap.append(head);

  if (isAdmin() && !hasJoined()) {
    wrap.append(el('div', { class: 'panel help-box' }, 'És administrador. Para também apostares, entra como jogador na página inicial (ou pede a alguém para entrar).'));
    return wrap;
  }

  // aposta atual
  loadMyBet(stage);

  const pickPanel = el('div', { class: 'panel' });
  pickPanel.dataset.role = 'pick';
  if (!stage.open) {
    pickPanel.append(el('div', { class: 'section-title' }, 'Aposta fechada'));
    pickPanel.append(el('div', { class: 'empty' }, 'Já não é possível apostar nesta etapa. Vê os resultados no separador Etapas.'));
  } else {
    pickPanel.append(el('div', { class: 'section-title' }, 'Escolhe o teu ciclista'));
    pickPanel.append(el('input', { placeholder: '🔍 Procurar ciclista ou equipa…', value: App.riderFilter, oninput: (e) => { App.riderFilter = e.target.value; refreshRiderGrid(stage); } }));
    pickPanel.append(renderRiderGrid(stage));
    const btn = el('button', { class: 'btn primary', style: 'margin-top:12px', onclick: () => submitBet(stage) }, 'Confirmar aposta');
    btn.dataset.role = 'confirm';
    pickPanel.append(btn);
  }
  wrap.append(pickPanel);
  return wrap;
}

function renderDeadline(stage) {
  const box = el('div', { style: 'margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap' });
  const badge = el('span', { class: 'badge ' + (stage.open ? 'open' : stage.status === 'scored' ? 'scored' : 'locked') },
    stage.open ? 'Apostas abertas' : stage.status === 'scored' ? 'Terminada' : 'Fechada');
  box.append(badge);
  if (stage.deadline) {
    const cd = el('span', { class: 'countdown', style: 'color:var(--muted)' });
    const tick = () => {
      const ms = new Date(stage.deadline).getTime() - Date.now();
      if (ms <= 0) { cd.textContent = 'fecho: ' + new Date(stage.deadline).toLocaleString('pt-PT'); return; }
      const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
      cd.textContent = `fecha em ${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    };
    tick(); const iv = setInterval(() => { if (!document.body.contains(cd)) return clearInterval(iv); tick(); }, 1000);
    box.append(cd);
  }
  return box;
}

async function loadMyBet(stage) {
  if (!hasJoined()) return;
  try {
    const detail = await api(`/games/${App.code}/stages/${stage.number}`, { token: true });
    const mine = detail.bets.find((b) => b.player.id === currentPlayer().playerId);
    const pickPanel = document.querySelector('[data-role="pick"]');
    if (mine && mine.rider) {
      App.selectedRider = mine.rider.id;
      const note = el('div', { class: 'chip', style: 'background:var(--yellow);margin-bottom:10px;display:inline-block' }, `A tua aposta: ${mine.rider.name}`);
      if (pickPanel && !pickPanel.querySelector('.mybet')) { note.classList.add('mybet'); pickPanel.prepend(note); }
      refreshRiderGrid(stage);
    }
  } catch {}
}

function riderUsable(stage, r) {
  if (r.status === 'abandoned') return { ok: false, tag: 'abandonou' };
  return { ok: true };
}

function renderRiderGrid(stage) {
  const grid = el('div', { class: 'riders-grid' });
  grid.dataset.role = 'grid';
  fillRiderGrid(grid, stage);
  return grid;
}
function refreshRiderGrid(stage) {
  const grid = document.querySelector('[data-role="grid"]');
  if (grid) fillRiderGrid(grid, stage);
}
function fillRiderGrid(grid, stage) {
  grid.innerHTML = '';
  const f = App.riderFilter.trim().toLowerCase();
  const list = App.riders.filter((r) => !f || r.name.toLowerCase().includes(f) || (r.team || '').toLowerCase().includes(f));
  if (!list.length) { grid.append(el('div', { class: 'empty' }, 'Nenhum ciclista encontrado.')); return; }
  for (const r of list) {
    const u = riderUsable(stage, r);
    const cls = 'rider' + (App.selectedRider === r.id ? ' selected' : '') + (u.ok ? '' : ' disabled');
    const node = el('button', { class: cls, onclick: u.ok ? () => { App.selectedRider = r.id; refreshRiderGrid(stage); } : null }, [
      el('span', { class: 'rname' }, r.name),
      el('span', { class: 'rteam' }, r.team || '—'),
      u.ok ? null : el('span', { class: 'rtag' }, u.tag),
    ]);
    grid.append(node);
  }
}

async function submitBet(stage) {
  if (!App.selectedRider) return toast('Escolhe um ciclista primeiro.', 'err');
  try {
    await api(`/games/${App.code}/stages/${stage.number}/bet`, { method: 'POST', token: true, body: { riderId: App.selectedRider } });
    toast('Aposta registada!', 'ok');
    await refresh();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------- Aba ETAPAS ---------------- */
function renderStagesTab() {
  const wrap = el('div');
  if (App.stageView != null) {
    wrap.append(el('button', { class: 'btn small ghost', style: 'margin-bottom:12px', onclick: () => { App.stageView = null; render(); } }, '← Todas as etapas'));
    wrap.append(renderStageDetail(App.stageView));
    return wrap;
  }
  const list = el('div', { class: 'stage-list' });
  for (const s of App.game.stages) {
    const statusBadge = el('span', { class: 'badge ' + (s.open ? 'open' : s.status === 'scored' ? 'scored' : 'locked') },
      s.open ? 'aberta' : s.status === 'scored' ? 'terminada' : 'fechada');
    list.append(el('div', { class: 'stage-row', onclick: () => { App.stageView = s.number; render(); } }, [
      el('span', { class: 'stage-num', style: 'min-width:38px;height:38px;font-size:15px' }, String(s.number)),
      el('div', { class: 'info' }, [
        el('div', { class: 't' }, s.name),
        el('div', { class: 'd' }, `Semana ${s.week} · ${typeLabel(s.type)} · ${s.betCount} aposta(s)` + (s.hasResults ? ' · com resultados' : '')),
      ]),
      statusBadge,
    ]));
  }
  wrap.append(el('div', { class: 'panel' }, [el('div', { class: 'section-title' }, '21 etapas'), list]));
  return wrap;
}

function renderStageDetail(number) {
  const panel = el('div', { class: 'panel' });
  panel.append(el('div', { class: 'empty' }, [el('span', { class: 'spinner' }), ' A carregar…']));
  api(`/games/${App.code}/stages/${number}`, { token: true }).then((d) => {
    panel.innerHTML = '';
    const st = d.stage;
    panel.append(el('div', { class: 'stage-head' }, [
      el('div', { style: 'display:flex;gap:10px;align-items:center' }, [
        el('span', { class: 'stage-num' }, String(st.number)),
        el('div', {}, [el('div', { style: 'font-weight:800' }, st.name), el('div', { style: 'color:var(--muted);font-size:13px' }, `Semana ${st.week}`)]),
      ]),
      el('span', { class: 'badge ' + (st.open ? 'open' : st.status === 'scored' ? 'scored' : 'locked') }, st.open ? 'aberta' : st.status === 'scored' ? 'terminada' : 'fechada'),
    ]));

    // Pontuações
    if (d.scores.length && st.status === 'scored') {
      panel.append(el('div', { class: 'section-title', style: 'margin-top:16px' }, 'Pontos da etapa'));
      const t = el('table');
      t.append(el('tr', { class: 'thead' }, [el('th', {}, 'Jogador'), el('th', {}, 'Ciclista'), el('th', { class: 'num' }, 'Pos'), el('th', { class: 'num' }, 'Pontos')].map((x) => x)));
      for (const s of d.scores) {
        const me = s.player.id === currentPlayer().playerId;
        const bet = d.bets.find((b) => b.player.id === s.player.id);
        t.append(el('tr', { class: me ? 'me' : '' }, [
          el('td', {}, [el('span', { class: 'dot', style: `background:${s.player.color}` }), s.player.name]),
          el('td', {}, bet && bet.rider ? bet.rider.name : el('span', { class: 'pen-tag' }, reasonLabel(s.reason))),
          el('td', { class: 'num' }, s.position ?? '—'),
          el('td', { class: 'num' }, [el('span', { class: 'pts' + (s.points < 0 ? ' neg' : '') }, fmtPts(s.points)), s.isStageWin ? el('span', { class: 'win-tag' }, ' 🏆') : null]),
        ]));
      }
      panel.append(t);
    }

    // Apostas (reveladas quando fechadas)
    panel.append(el('div', { class: 'section-title', style: 'margin-top:16px' }, d.revealBets ? 'Apostas' : 'Apostas (secretas até fechar)'));
    const bt = el('table');
    for (const b of d.bets) {
      bt.append(el('tr', {}, [
        el('td', {}, [el('span', { class: 'dot', style: `background:${b.player.color}` }), b.player.name]),
        el('td', {}, b.placed ? (b.rider ? b.rider.name : '🔒 apostou') : el('span', { style: 'color:var(--muted)' }, 'sem aposta')),
      ]));
    }
    panel.append(bt);

    // Resultados
    if (d.results.length) {
      panel.append(el('div', { class: 'section-title', style: 'margin-top:16px' }, 'Classificação da etapa'));
      const rt = el('table');
      rt.append(el('tr', {}, [el('th', { class: 'num' }, 'Pos'), el('th', {}, 'Ciclista'), el('th', {}, 'Equipa')]));
      for (const r of d.results.slice(0, 30)) {
        rt.append(el('tr', {}, [el('td', { class: 'num' }, r.position), el('td', {}, r.rider?.name || '—'), el('td', {}, r.rider?.team || '—')]));
      }
      panel.append(rt);
    }
  }).catch((e) => { panel.innerHTML = ''; panel.append(el('div', { class: 'empty' }, 'Erro: ' + e.message)); });
  return panel;
}

/* ---------------- Aba CLASSIFICAÇÃO ---------------- */
function renderStandingsTab() {
  const wrap = el('div', { class: 'panel' });
  wrap.append(el('div', { class: 'section-title' }, 'Classificação geral'));
  wrap.append(el('p', { class: 'sub' }, 'Menos pontos = melhor. Desempate: mais vitórias de etapa, depois mais 2.ºs lugares, etc.'));
  const box = el('div');
  box.append(el('div', { class: 'empty' }, [el('span', { class: 'spinner' }), ' A calcular…']));
  api(`/games/${App.code}/standings`).then((d) => {
    box.innerHTML = '';
    if (!d.standings.length) { box.append(el('div', { class: 'empty' }, 'Ainda não há jogadores.')); return; }
    const t = el('table');
    t.append(el('tr', {}, [el('th', {}, '#'), el('th', {}, 'Jogador'), el('th', { class: 'num' }, 'Vit.'), el('th', { class: 'num' }, 'Etapas'), el('th', { class: 'num' }, 'Pontos')]));
    for (const s of d.standings) {
      const me = s.playerId === currentPlayer().playerId;
      t.append(el('tr', { class: me ? 'me' : '' }, [
        el('td', { class: 'rank' }, String(s.rank)),
        el('td', {}, [el('span', { class: 'dot', style: `background:${s.color}` }), s.name]),
        el('td', { class: 'num' }, String(s.wins)),
        el('td', { class: 'num' }, String(s.stagesPlayed)),
        el('td', { class: 'num pts' + (s.total < 0 ? ' neg' : '') }, fmtPts(s.total)),
      ]));
    }
    box.append(t);
  }).catch((e) => { box.innerHTML = ''; box.append(el('div', { class: 'empty' }, 'Erro: ' + e.message)); });
  wrap.append(box);
  return wrap;
}

/* ---------------- Aba ADMIN ---------------- */
function renderAdminTab() {
  const wrap = el('div');

  // Startlist
  const sl = el('div', { class: 'panel' });
  sl.append(el('div', { class: 'section-title' }, `Startlist (${App.game.ridersCount} ciclistas)`));
  sl.append(el('p', { class: 'sub' }, 'Importa os ciclistas da prova. Tenta buscar automaticamente ao ProCyclingStats; se falhar, cola a lista (um ciclista por linha, opcionalmente "Nome; Equipa").'));
  const slText = el('textarea', { class: '', placeholder: 'Tadej Pogacar; UAE Team Emirates\nJonas Vingegaard; Visma\n…', style: 'width:100%;min-height:120px;font-family:ui-monospace,monospace;font-size:13px;padding:10px;border-radius:10px;border:1px solid var(--line)' });
  sl.append(slText);
  sl.append(el('div', { class: 'btn-row', style: 'margin-top:10px' }, [
    el('button', { class: 'btn small', onclick: (ev) => fetchStartlist(ev, slText) }, '⤓ Buscar automaticamente (PCS)'),
    el('button', { class: 'btn small primary', onclick: () => importStartlist(slText) }, 'Importar lista'),
  ]));
  wrap.append(sl);

  // Gestão de etapa
  const stagePanel = el('div', { class: 'panel' });
  if (App.adminStage == null) App.adminStage = App.game.currentStageNumber;
  const sel = el('select', { onchange: (e) => { App.adminStage = +e.target.value; render(); } });
  for (const s of App.game.stages) sel.append(el('option', { value: s.number, ...(s.number === App.adminStage ? { selected: 'selected' } : {}) }, `Etapa ${s.number} — ${s.name} (${s.status})`));
  const st = stageByNumber(App.adminStage);
  stagePanel.append(el('div', { class: 'section-title' }, 'Gerir etapa'));
  stagePanel.append(sel);
  stagePanel.append(el('div', { class: 'btn-row', style: 'margin:12px 0' }, [
    st.open
      ? el('button', { class: 'btn small', onclick: () => lockStage(st, false) }, '🔒 Fechar apostas')
      : el('button', { class: 'btn small', onclick: () => lockStage(st, true) }, '🔓 Reabrir apostas'),
    el('button', { class: 'btn small ghost', onclick: () => { App.stageView = st.number; App.tab = 'etapas'; render(); } }, 'Ver detalhe'),
  ]));
  stagePanel.append(el('div', { class: 'section-title', style: 'margin-top:8px' }, 'Resultados da etapa'));
  stagePanel.append(el('p', { class: 'sub' }, 'Um ciclista por linha, por ordem de chegada (1.º na primeira linha). Podes buscar ao PCS e corrigir antes de gravar.'));
  const resText = el('textarea', { placeholder: 'Tadej Pogacar\nJonas Vingegaard\nRemco Evenepoel\n…', style: 'width:100%;min-height:140px;font-family:ui-monospace,monospace;font-size:13px;padding:10px;border-radius:10px;border:1px solid var(--line)' });
  stagePanel.append(resText);
  stagePanel.append(el('div', { class: 'btn-row', style: 'margin-top:10px' }, [
    el('button', { class: 'btn small', onclick: (ev) => fetchResults(ev, st, resText) }, '⤓ Buscar resultados (PCS)'),
    el('button', { class: 'btn small primary', onclick: () => saveResults(st, resText) }, 'Gravar e pontuar'),
  ]));
  wrap.append(stagePanel);

  // Abandonos
  const ab = el('div', { class: 'panel' });
  ab.append(el('div', { class: 'section-title' }, 'Abandonos'));
  ab.append(el('p', { class: 'sub' }, 'Marca ciclistas que abandonaram: quem apostou neles é penalizado (pior jogador + 50).'));
  const abFilter = el('input', { placeholder: '🔍 Procurar ciclista…', oninput: (e) => fillAbandonList(abList, e.target.value) });
  const abList = el('div', { class: 'chips', style: 'margin-top:10px;max-height:200px;overflow:auto' });
  fillAbandonList(abList, '');
  ab.append(abFilter, abList);
  wrap.append(ab);

  // Definições
  const cfg = el('div', { class: 'panel' });
  cfg.append(el('div', { class: 'section-title' }, 'Regras (avançado)'));
  const s = App.game.game.settings;
  const inBonus = el('input', { type: 'number', value: s.winnerBonus });
  const inPen = el('input', { type: 'number', value: s.penaltyMargin });
  const inRep = el('input', { type: 'number', min: '1', value: s.repeatLimit });
  cfg.append(el('div', { class: 'kv' }, [
    el('label', {}, 'Bónus por acertar no vencedor'), inBonus,
    el('label', {}, 'Margem de penalização (pior + X)'), inPen,
    el('label', {}, 'Máx. repetições do mesmo ciclista'), inRep,
  ]));
  cfg.append(el('button', { class: 'btn small primary', style: 'margin-top:12px', onclick: () => saveSettings({ winnerBonus: +inBonus.value, penaltyMargin: +inPen.value, repeatLimit: +inRep.value }) }, 'Guardar regras'));
  wrap.append(cfg);

  return wrap;
}

function fillAbandonList(container, filter) {
  container.innerHTML = '';
  const f = (filter || '').toLowerCase();
  const list = App.riders.filter((r) => !f || r.name.toLowerCase().includes(f));
  if (!list.length) { container.append(el('div', { class: 'empty' }, 'Sem ciclistas.')); return; }
  for (const r of list.slice(0, 60)) {
    const abandoned = r.status === 'abandoned';
    container.append(el('button', {
      class: 'chip', style: abandoned ? 'background:#fde8e8;color:#b42318' : '',
      onclick: () => toggleAbandon(r),
    }, (abandoned ? '✖ ' : '') + r.name));
  }
}

/* ----- ações admin ----- */
function parseRiderLines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, team] = l.split(/[;|\t]/).map((x) => (x || '').trim());
    return { name, team: team || null };
  });
}
async function importStartlist(textarea) {
  const riders = parseRiderLines(textarea.value);
  if (!riders.length) return toast('Cola pelo menos um ciclista.', 'err');
  try {
    const r = await api(`/games/${App.code}/admin/startlist`, { method: 'POST', admin: true, body: { riders } });
    toast(`${r.imported} ciclistas importados.`, 'ok');
    await refresh();
  } catch (e) { toast(e.message, 'err'); }
}
async function fetchStartlist(ev, textarea) {
  const btn = ev.target; btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> a buscar…';
  try {
    const r = await api(`/games/${App.code}/admin/fetch-startlist`, { method: 'POST', admin: true });
    textarea.value = r.riders.map((x) => x.name + (x.team ? '; ' + x.team : '')).join('\n');
    toast(`${r.riders.length} ciclistas obtidos. Confirma e importa.`, 'ok');
  } catch (e) { toast(e.message + (e.data?.detail ? ' (' + e.data.detail + ')' : ''), 'err'); }
  finally { btn.disabled = false; btn.textContent = old; }
}
async function lockStage(stage, reopen) {
  try { await api(`/games/${App.code}/admin/stages/${stage.number}/lock`, { method: 'POST', admin: true, body: { reopen } }); toast(reopen ? 'Apostas reabertas.' : 'Apostas fechadas.', 'ok'); await refresh(); }
  catch (e) { toast(e.message, 'err'); }
}
async function fetchResults(ev, stage, textarea) {
  const btn = ev.target; btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> a buscar…';
  try {
    const r = await api(`/games/${App.code}/admin/stages/${stage.number}/fetch-results`, { method: 'POST', admin: true });
    textarea.value = r.results.map((x) => x.name).join('\n');
    toast(`${r.results.length} resultados obtidos. Confirma e grava.`, 'ok');
  } catch (e) { toast(e.message + (e.data?.detail ? ' (' + e.data.detail + ')' : ''), 'err'); }
  finally { btn.disabled = false; btn.textContent = old; }
}
async function saveResults(stage, textarea) {
  const names = textarea.value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!names.length) return toast('Introduz a classificação da etapa.', 'err');
  const results = names.map((name, i) => ({ name: name.split(/[;|\t]/)[0].trim(), position: i + 1 }));
  try {
    const r = await api(`/games/${App.code}/admin/stages/${stage.number}/results`, { method: 'POST', admin: true, body: { results } });
    toast(`Etapa pontuada! (penalização = ${r.penalty})`, 'ok');
    await refresh();
  } catch (e) { toast(e.message, 'err'); }
}
async function toggleAbandon(rider) {
  const status = rider.status === 'abandoned' ? 'active' : 'abandoned';
  try { await api(`/games/${App.code}/admin/riders/${rider.id}/status`, { method: 'POST', admin: true, body: { status } }); toast(status === 'abandoned' ? `${rider.name} marcado como abandono.` : `${rider.name} reativado.`, 'ok'); await refresh(); }
  catch (e) { toast(e.message, 'err'); }
}
async function saveSettings(patch) {
  try { await api(`/games/${App.code}/admin/settings`, { method: 'PUT', admin: true, body: { settings: patch } }); toast('Regras guardadas e pontuações recalculadas.', 'ok'); await refresh(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ---------------- go ---------------- */
document.addEventListener('DOMContentLoaded', boot);
