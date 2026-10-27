'use strict';
/* Driftskalender: fælles tilgængelighed (Gulvvagt / På kald) og opgaver for driftsgruppen.
   Al data og al adgangskontrol ligger i databasen. Denne side er kun brugerfladen. */
(function () {

const API_URL = 'https://cqhgtbyytkczalmqamck.supabase.co/functions/v1/driftskalender';

// Fiberfarver (efter det internationale farvekodesystem for fiberkabler, uden rød som er forbeholdt advarsler).
const STRANDS = ['#2467C9', '#E27A12', '#2F9E5B', '#8B5E3C', '#7A4DB8', '#5B7385',
                 '#D6538A', '#12A3A8', '#B58F00', '#3E4FA0', '#6E8F1B', '#8E3B6B'];
const ROLES = { teamleder: 'Teamleder', tuk: 'TUK', problemmanager: 'ProblemManager', drift: 'Drift' };
const MODE_LABEL = { gulvvagt: 'Gulvvagt', kald: 'På kald' };
const PRIO_LABEL = { fast: 'Kan ikke aflyses/udsættes', fleksibel: 'Foretages ved tid / mulighed' };
const VIEWS = ['kalender', 'opgaver', 'medarbejdere'];

const DAY_LONG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
const DAY_SHORT = ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'];
const MONTH_LONG = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dow = d => (d.getDay() + 6) % 7;
const mondayOf = d => addDays(d, -dow(d));
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const fmtLong = d => `${DAY_LONG[dow(d)]} ${d.getDate()}. ${MONTH_LONG[d.getMonth()]}`;
const fmtShort = d => `${d.getDate()}. ${MONTH_SHORT[d.getMonth()]}`;
const todayISO = () => iso(new Date());

const TIMES = [];
for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 15) TIMES.push(`${pad(h)}:${pad(m)}`);
const END_TIMES = TIMES.slice(1).concat('23:59');
const PRESETS = [['Formiddag', '08:00', '12:00'], ['Eftermiddag', '12:00', '16:00'], ['Aften', '16:00', '21:00'], ['Hele dagen', '08:00', '16:00']];

// Tekster til tilmeldinger. Der kan kun være én gulvvagt ad gangen, men flere kan tilbyde sig hver sit tidsrum,
// så tallet er antal personer der er tilgængelige som gulvvagt, ikke antal der står på gulvet samtidig.
const gvText = n => n === 1 ? '1 tilgængelig gulvvagt' : `${n} tilgængelige gulvvagter`;
const countsText = s => `${gvText(s.g)}, ${s.k} på kald`;
const hourText = t => t === '23:59' ? '24' : t.endsWith(':00') ? t.slice(0, 2) : t; // 08:00 → 08, 23:59 → 24
const rangeText = a => `${hourText(a.start)}–${hourText(a.end)}`;
const initialsOf = name => name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();

// Ønsker om støtte fra driften. Særligt ønske: Gulvvagt og Stafet, begge med dækningsstatus (grøn/gul/rød).
// Øvrigt ønske (lilla): På kald eller administrative opgaver. Gulvvagt og Stafet dækkes af gulvvagt-tilmeldinger i tidsrummet.
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fromMin = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
const REQ_KINDS = [['gulvvagt', 'Gulvvagt'], ['stafet', 'Stafet'], ['kald', 'På kald'], ['admin', 'Administrative opgaver']];
const REQ_GROUPS = [['teamleder', 'Teamledere'], ['tuk', "TUK'er"], ['problemmanager', 'ProblemManager']];
const REQ_ORDER = ['missing', 'partial', 'covered', 'info']; // værst først
// Tekst i kalenderens mærke (lang og kort) pr. type og status
const REQ_CELL = {
  gulvvagt: { covered: 'GV dækket', partial: 'GV delvist', missing: 'Mangler GV', short: 'GV' },
  stafet: { covered: 'Stafet dækket', partial: 'Stafet delvist', missing: 'Mangler stafet', short: 'Stafet' },
  kald: { info: 'På kald', short: 'Kald' },
  admin: { info: 'Administrativt', short: 'Adm.' },
};
const reqKindLabel = kind => (REQ_KINDS.find(k => k[0] === kind) || [0, ''])[1];
const isSpecial = r => r.kind === 'gulvvagt' || r.kind === 'stafet'; // ellers er det et øvrigt ønske
const timeRequired = kind => kind === 'gulvvagt' || kind === 'stafet' || kind === 'kald';
const hasCoverage = r => r.kind === 'gulvvagt' || r.kind === 'stafet'; // kun disse kan være dækket eller mangle
const reqTime = r => r.start ? `${r.start}–${r.end}` : '';
const reqStateText = (state, kind) => state === 'covered' ? 'Dækket' : state === 'partial' ? 'Delvist dækket' : kind === 'stafet' ? 'Mangler stafet' : 'Mangler gulvvagt';
// "Gulvvagt ønskes 08:00–16:00", "Stafet ønskes 16:00–21:00", "På kald 08:00–16:00", "Administrative opgaver"
const reqWhat = r => {
  const t = reqTime(r);
  if (hasCoverage(r)) return `${reqKindLabel(r.kind)} ønskes ${t}`;
  return reqKindLabel(r.kind) + (t ? ' ' + t : '');
};
function coverageOf(req, items) {
  if (!hasCoverage(req)) return null;
  const rs = toMin(req.start), re = toMin(req.end);
  const segs = items.filter(a => a.mode === 'gulvvagt')
    .map(a => ({ s: Math.max(rs, toMin(a.start)), e: Math.min(re, toMin(a.end)), a }))
    .filter(x => x.e > x.s)
    .sort((x, y) => x.s - y.s || x.e - y.e);
  const gaps = [];
  let cur = rs;
  for (const x of segs) { if (x.s > cur) gaps.push([fromMin(cur), fromMin(x.s)]); cur = Math.max(cur, x.e); }
  if (cur < re) gaps.push([fromMin(cur), fromMin(re)]);
  return { state: !gaps.length ? 'covered' : segs.length ? 'partial' : 'missing', gaps, segs: segs.map(x => x.a) };
}
const reqState = (req, cov) => cov ? cov.state : 'info';
const reqCellLabel = (req, cov) => REQ_CELL[req.kind][reqState(req, cov)];
// Samme oplysninger som tekst: bruges til hover og skærmlæsere
const reqText = (req, cov) => {
  const parts = [reqWhat(req).toLowerCase()];
  if (cov) parts.push(reqStateText(cov.state, req.kind).toLowerCase());
  if (req.note) parts.push(req.note);
  return parts.join(', ');
};
const worstState = states => REQ_ORDER.find(s => states.includes(s)) || null;

const $ = sel => document.querySelector(sel);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ingen lagring */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ingen lagring */ } },
};

/* ---------- DOM-hjælpere (al tekst sættes som tekst, aldrig som HTML) ---------- */
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'vars') { for (const [vk, vv] of Object.entries(v)) n.style.setProperty(vk, vv); }
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
}
function mark(size) {
  const pts = [[16, 16, 4.4, '#14222D'], [25.5, 16, 3.6, STRANDS[0]], [20.75, 24.2, 3.6, STRANDS[1]],
               [11.25, 24.2, 3.6, STRANDS[2]], [6.5, 16, 3.6, STRANDS[3]], [11.25, 7.8, 3.6, STRANDS[4]], [20.75, 7.8, 3.6, STRANDS[5]]];
  const s = svgEl('svg', { viewBox: '0 0 32 32', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' });
  pts.forEach(([cx, cy, r, fill], i) => {
    const c = svgEl('circle', { cx, cy, r, fill, class: 'mark-dot' });
    c.style.setProperty('--i', i);
    s.append(c);
  });
  return s;
}
function heroMark() {
  // Kabeltværsnit på mørk baggrund: midten er hvid, de seks fibre i hver sin farve.
  const s = mark(320);
  s.firstChild.setAttribute('fill', '#ffffff');
  return s;
}

/* ---------- Tilstand ---------- */
const S = {
  token: store.get('dk_token'),
  me: null, members: [], avail: [], tasks: [], requests: [],
  colors: {},
  view: 'kalender',
  month: startOfMonth(new Date()),
  selected: null, sheetOpen: false, form: null,
  multi: false, picked: new Set(),
  focusMember: null,
  onlyMine: false, showDone: false,
  range: null, sig: '',
};
const memberById = id => S.members.find(m => m.id === id);
// Drift har kun læseadgang. De kan ikke skrive sig på eller have opgaver, så de indgår ikke som personer i kalender og opgaver.
const isViewer = () => !!S.me && S.me.role === 'drift';
const activeMembers = () => S.members.filter(m => m.active && m.role !== 'drift');
const colorOf = id => S.colors[id] || STRANDS[0];

function rankColors() {
  const ids = S.members.map(m => m.id).sort();
  S.colors = {};
  ids.forEach((id, i) => { S.colors[id] = STRANDS[i % STRANDS.length]; });
}

/* ---------- API ---------- */
async function api(action, data, opts) {
  const o = opts || {};
  const body = Object.assign({ action }, data || {});
  if (o.auth !== false && S.token) body.token = S.token;
  let res;
  try {
    // text/plain undgår en ekstra forespørgsel (preflight) før hvert kald
    res = await fetch(API_URL, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, network: true, error: 'Kunne ikke kontakte serveren. Tjek forbindelsen og prøv igen.' };
  }
  let json;
  try { json = await res.json(); } catch (e) {
    return { ok: false, error: 'Uventet svar fra serveren. Prøv igen om lidt.' };
  }
  if (json && json.auth === false && o.auth !== false) sessionExpired();
  return json;
}

function sessionExpired() {
  if (!S.token) return;
  store.del('dk_token');
  S.token = null; S.me = null;
  showLogin('Din session er udløbet. Log ind igen.');
}

/* ---------- Indlæsning ---------- */
function gridRange(month) {
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return [mondayOf(month), addDays(mondayOf(last), 6)];
}
const sigOf = r => JSON.stringify([r.members, r.availability, r.tasks, r.requests || []]);
function applyData(r, from, to) {
  S.me = r.me; S.members = r.members; S.avail = r.availability; S.tasks = r.tasks; S.requests = r.requests || [];
  S.range = [from, to];
  S.sig = sigOf(r);
  rankColors();
}
async function loadData() {
  const [f, t] = gridRange(S.month);
  const from = iso(f), to = iso(t);
  const r = await api('load', { from, to });
  if (r && r.ok) applyData(r, from, to);
  return r;
}
async function reload() {
  const r = await loadData();
  if (r && r.ok) renderApp();
  else if (r && r.error && r.auth !== false) toast(r.error, true);
  return r;
}
async function silentRefresh() {
  if (!S.token || !S.me || !S.range || document.hidden || document.querySelector('dialog[open]') || S.multi) return;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.panel input, .panel select')) return;
  const r = await api('load', { from: S.range[0], to: S.range[1] });
  if (!r || !r.ok) return;
  if (sigOf(r) === S.sig) return;
  applyData(r, S.range[0], S.range[1]);
  renderApp();
}

/* ---------- Visning ---------- */
function renderApp() {
  if (!S.me) return;
  const active = document.activeElement;
  const fk = active && active.getAttribute ? active.getAttribute('data-fk') : null;
  const y = window.scrollY;
  const view = S.view === 'medarbejdere' && !(S.me.is_admin || isViewer()) ? 'kalender' : S.view;
  S.view = view;
  document.title = `${{ kalender: 'Kalender', opgaver: 'Opgaver', medarbejdere: 'Medarbejdere' }[view]} · Driftskalender`;
  const content = view === 'kalender' ? viewCalendar() : view === 'opgaver' ? viewTasks() : viewMembers();
  $('#app').replaceChildren(el('div', { class: 'shell' }, topbar(), el('main', { class: 'page', id: 'main' }, content)));
  window.scrollTo(0, y);
  if (fk) {
    const safe = (window.CSS && CSS.escape) ? CSS.escape(fk) : fk.replace(/"/g, '\\"');
    const n = document.querySelector(`[data-fk="${safe}"]`);
    if (n) n.focus({ preventScroll: true });
  }
}

function go(view) {
  S.view = view;
  S.sheetOpen = false;
  try { history.replaceState(null, '', '#' + view); } catch (e) { /* ingen historik */ }
  renderApp();
}

function topbar() {
  const tabs = [['kalender', 'Kalender'], ['opgaver', 'Opgaver']];
  if (S.me.is_admin || isViewer()) tabs.push(['medarbejdere', 'Medarbejdere']);
  return el('header', { class: 'topbar' },
    el('a', { class: 'brand', href: '#kalender', onclick: e => { e.preventDefault(); go('kalender'); } },
      mark(28), el('span', { class: 'brand-name', text: 'Driftskalender' })),
    el('nav', { class: 'tabs', 'aria-label': 'Hovedmenu' },
      tabs.map(([k, l]) => el('button', {
        type: 'button', class: 'tab' + (S.view === k ? ' on' : ''), 'aria-current': S.view === k ? 'page' : null,
        'data-fk': 'tab-' + k, onclick: () => go(k), text: l,
      }))),
    accountMenu());
}

function accountMenu() {
  const details = el('details', { class: 'acct' },
    el('summary', { 'aria-label': 'Min konto' },
      el('span', { class: 'who', text: S.me.name }),
      el('span', { class: 'role', text: (ROLES[S.me.role] || '') + (S.me.is_admin ? ', administrator' : '') + (isViewer() ? ', kun læseadgang' : '') })),
    el('div', { class: 'acct-menu' },
      el('button', { type: 'button', text: 'Skift adgangskode', onclick: () => { details.open = false; passwordDialog(); } }),
      el('button', { type: 'button', text: 'Log ud', onclick: logout })));
  return details;
}

/* ---------- Kalender ---------- */
function viewCalendar() {
  const [f, t] = gridRange(S.month);
  const lanes = activeMembers();
  const activeIds = new Set(lanes.map(m => m.id));
  const byDay = {};
  for (const a of S.avail) if (activeIds.has(a.member_id)) (byDay[a.day] = byDay[a.day] || []).push(a);
  const today = todayISO();
  const reqByDay = {};
  for (const r of S.requests) (reqByDay[r.day] = reqByDay[r.day] || []).push(r);

  // Kort navn i cellerne: fornavn, og med efternavnsbogstav hvis to har samme fornavn.
  const firstOf = n => n.trim().split(/\s+/)[0];
  const sameFirst = {};
  for (const m of lanes) { const k = firstOf(m.name).toLowerCase(); sameFirst[k] = (sameFirst[k] || 0) + 1; }
  const shortName = m => {
    if (!m) return '';
    const parts = m.name.trim().split(/\s+/);
    return sameFirst[parts[0].toLowerCase()] > 1 && parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  };

  const summarize = items => {
    const g = new Set(), k = new Set();
    for (const a of items) (a.mode === 'gulvvagt' ? g : k).add(a.member_id);
    return { g: g.size, k: k.size };
  };

  const toolbar = el('div', { class: 'cal-toolbar' },
    el('div', { class: 'cal-nav' },
      el('button', { type: 'button', class: 'btn', 'aria-label': 'Forrige måned', text: '‹', onclick: () => changeMonth(-1) }),
      el('button', { type: 'button', class: 'btn', 'aria-label': 'Næste måned', text: '›', onclick: () => changeMonth(1) }),
      el('button', { type: 'button', class: 'btn', text: 'I dag', onclick: () => { S.month = startOfMonth(new Date()); S.selected = today; S.form = newForm(); S.sheetOpen = true; changeMonth(0); } })),
    el('h1', { class: 'cal-title', text: `${MONTH_LONG[S.month.getMonth()]} ${S.month.getFullYear()}` }),
    isViewer() ? null : el('button', {
      type: 'button', class: 'btn' + (S.multi ? ' primary' : ''), 'aria-pressed': S.multi ? 'true' : 'false',
      text: S.multi ? 'Færdig med at vælge' : 'Vælg flere dage',
      onclick: () => { S.multi = !S.multi; S.picked.clear(); S.sheetOpen = false; renderApp(); },
    }),
    (() => {
      const tdItems = byDay[today];
      if (!tdItems && !(today >= iso(f) && today <= iso(t))) return null;
      const s = summarize(tdItems || []);
      return el('p', { class: 'today-line' }, 'I dag: ', el('b', { text: gvText(s.g) }), `, ${s.k} på kald`);
    })());

  const legend = el('div', { class: 'legend', role: 'group', 'aria-label': 'Fremhæv en person' },
    lanes.map(m => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': S.focusMember === m.id ? 'true' : 'false',
      vars: { '--c': colorOf(m.id) }, 'data-fk': 'chip-' + m.id,
      onclick: () => { S.focusMember = S.focusMember === m.id ? null : m.id; renderApp(); },
    }, el('span', { class: 'sw' }), m.name)),
    el('span', { class: 'key' }, el('span', { class: 'dot g' }), 'Gulvvagt'),
    el('span', { class: 'key' }, el('span', { class: 'dot k' }), 'På kald'),
    el('span', { class: 'key req-keys' }, 'Særligt ønske om støtte:',
      [['covered', 'Dækket'], ['partial', 'Delvist dækket'], ['missing', 'Mangler']]
        .map(([s, t]) => el('span', { class: `req ${s} req-key` }, el('span', { class: 'req-lbl', text: t })))),
    el('span', { class: 'key req-keys' }, el('span', { class: 'req info req-key' }, el('span', { class: 'req-lbl', text: 'Øvrigt ønske om støtte' }))));

  // Overblik over måneden: hvor mange ønsker om støtte, og hvor mange mangler stadig en gulvvagt.
  const monthKey = `${S.month.getFullYear()}-${pad(S.month.getMonth() + 1)}`;
  const monthReqs = S.requests.filter(r => r.day.slice(0, 7) === monthKey);
  const reqSummary = (() => {
    if (!monthReqs.length) return null;
    const n = { missing: 0, missingStafet: 0, partial: 0, covered: 0, info: 0 };
    for (const r of monthReqs) {
      const s = reqState(r, coverageOf(r, byDay[r.day] || []));
      n[s === 'missing' && r.kind === 'stafet' ? 'missingStafet' : s]++;
    }
    const parts = [];
    if (n.missing) parts.push(['missing', `${n.missing} mangler gulvvagt`]);
    if (n.missingStafet) parts.push(['missing', `${n.missingStafet} mangler stafet`]);
    if (n.partial) parts.push(['partial', `${n.partial} delvist dækket`]);
    if (n.covered) parts.push(['covered', `${n.covered} dækket`]);
    const month = MONTH_LONG[S.month.getMonth()];
    return el('p', { class: 'req-summary' },
      parts.length ? [`Særligt ønske om støtte i ${month}: `, parts.map(([s, t], i) => [i ? ' · ' : '', el('b', { class: 'rs ' + s, text: t })])] : null,
      n.info ? [parts.length ? '. ' : '', 'Øvrigt ønske om støtte: ', el('b', { class: 'rs info', text: String(n.info) })] : null);
  })();

  // Opgaver med periode (fra og til) tegnes som bjælker hen over dagene, i spor så de ikke dækker hinanden.
  const MAX_LANES = 4;
  const ptasks = periodTasks();
  const tasksOn = key => ptasks.filter(x => x.start_date <= key && x.end_date >= key);

  const dayCell = (d, col, hiddenN) => {
    const key = iso(d);
    const items = byDay[key] || [];
    const sum = summarize(items);
    const other = d.getMonth() !== S.month.getMonth();
    const picked = S.picked.has(key);
    const sel = !S.multi && S.selected === key;
    // Hver tilmelding står som tekst i cellen: Gulvvagt først, så På kald, hver sorteret efter starttidspunkt.
    const entries = items.slice().sort((a, b) =>
      (a.mode === b.mode ? 0 : a.mode === 'gulvvagt' ? -1 : 1) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const sign = entries.length ? el('span', { class: 'sign', 'aria-hidden': 'true' }, entries.map(a => {
      const m = memberById(a.member_id);
      const kind = a.mode === 'gulvvagt' ? 'g' : 'k';
      return el('span', {
        class: `sg ${kind}` + (S.focusMember === a.member_id ? ' is-focus' : ''), vars: { '--c': colorOf(a.member_id) },
        title: `${m ? m.name : ''}: ${MODE_LABEL[a.mode]} ${a.start}–${a.end}`,
      },
        el('i', { class: `dot ${kind}` }),
        el('span', { class: 'sg-name', text: shortName(m) }),
        el('span', { class: 'sg-ini', text: m ? initialsOf(m.name) : '' }),
        el('span', { class: 'sg-time', text: rangeText(a) }));
    })) : null;
    const nTasks = tasksOn(key).length;
    // Særligt ønske om støtte: ét mærke pr. ønske øverst i cellen, og en farvet stribe efter det værste.
    const reqs = reqByDay[key] || [];
    const covs = reqs.map(r => coverageOf(r, items));
    const states = reqs.map((r, i) => reqState(r, covs[i]));
    const worst = worstState(states);
    const reqLines = reqs.length ? el('span', { class: 'req-lines', 'aria-hidden': 'true' }, reqs.map((r, i) =>
      el('span', { class: `req ${states[i]}`, title: reqText(r, covs[i]) },
        el('span', { class: 'req-lbl', text: reqCellLabel(r, covs[i]) }),
        el('span', { class: 'req-short', text: REQ_CELL[r.kind].short }),
        r.start ? el('span', { class: 'req-time', text: rangeText(r) }) : null))) : null;
    const label = `${fmtLong(d)}, ` + (entries.length
      ? `${countsText(sum)}: ` + entries.map(a => `${shortName(memberById(a.member_id))} ${MODE_LABEL[a.mode]} ${a.start}–${a.end}`).join(', ')
      : 'ingen tilmeldte')
      + (nTasks ? `, ${nTasks} ${nTasks === 1 ? 'opgave' : 'opgaver'} i perioden` : '')
      + reqs.map((r, i) => `. ${isSpecial(r) ? 'Særligt' : 'Øvrigt'} ønske om støtte: ${reqText(r, covs[i])}`).join('');
    return el('button', {
      type: 'button',
      class: 'cell' + (other ? ' other' : '') + (dow(d) >= 5 ? ' wknd' : '') + (key === today ? ' today' : '') + (sel ? ' sel' : '') + (picked ? ' picked' : '') + (worst ? ` has-req req-${worst}` : ''),
      'aria-label': label, 'aria-pressed': (S.multi ? picked : sel) ? 'true' : 'false', 'data-fk': 'd-' + key,
      vars: { '--col': col + 1 },
      onclick: () => onDay(key),
    },
      el('span', { class: 'cell-top' },
        el('span', { class: 'dnum', text: d.getDate() === 1 ? `1. ${MONTH_SHORT[d.getMonth()]}` : String(d.getDate()) })),
      reqLines,
      sign,
      hiddenN ? el('span', { class: 'more', 'aria-hidden': 'true', text: `+${hiddenN}` }) : null);
  };

  const periodBar = (seg, wsKey) => {
    const x = seg.t, who = memberById(x.assignee_id);
    const name = who ? who.name : '';
    const when = periodText(x);
    return el('button', {
      type: 'button',
      class: 'pbar' + (x.priority === 'fast' ? ' fast' : '') + (S.focusMember === x.assignee_id ? ' is-focus' : '') + (seg.contL ? ' cont-l' : '') + (seg.contR ? ' cont-r' : ''),
      vars: { '--c': colorOf(x.assignee_id), '--cs': seg.a + 1, '--ce': seg.e + 2, '--lane': seg.lane },
      title: `${x.title}\n${name}, ${when}`,
      'aria-label': `Opgave: ${x.title}, ${name}, ${when}` + (x.priority === 'fast' ? `, ${PRIO_LABEL.fast}` : ''),
      'data-fk': `pb-${x.id}-${wsKey}`, 'data-task': x.id,
      onclick: () => taskDialog(x, x.assignee_id),
    },
      x.priority === 'fast' ? el('span', { class: 'pb-flag', 'aria-hidden': 'true' }) : null,
      who ? el('span', { class: 'pb-who', text: shortName(who) }) : null,
      el('span', { class: 'pb-title', text: x.title }));
  };

  const weeks = [];
  for (let ws = f; ws <= t; ws = addDays(ws, 7)) {
    const wsKey = iso(ws), weKey = iso(addDays(ws, 6));
    const segs = ptasks.filter(x => x.start_date <= weKey && x.end_date >= wsKey).map(x => ({
      t: x, lane: 0,
      a: x.start_date < wsKey ? 0 : dow(parseISO(x.start_date)),
      e: x.end_date > weKey ? 6 : dow(parseISO(x.end_date)),
      contL: x.start_date < wsKey, contR: x.end_date > weKey,
    }));
    const laneEnd = []; // sidste kolonne der er optaget i hvert spor
    for (const s of segs) {
      let l = laneEnd.findIndex(end => end < s.a);
      if (l === -1) { l = laneEnd.length; laneEnd.push(-1); }
      laneEnd[l] = s.e; s.lane = l;
    }
    const shown = segs.filter(s => s.lane < MAX_LANES);
    const hidden = segs.filter(s => s.lane >= MAX_LANES);
    const hiddenByCol = [0, 0, 0, 0, 0, 0, 0];
    for (const s of hidden) for (let c = s.a; c <= s.e; c++) hiddenByCol[c]++;
    const bars = Math.min(MAX_LANES, laneEnd.length);
    weeks.push(el('div', { class: 'cal-week', vars: { '--bars': bars, '--lanes': bars + (hidden.length ? 0.7 : 0) } },
      [0, 1, 2, 3, 4, 5, 6].map(i => dayCell(addDays(ws, i), i, hiddenByCol[i])),
      shown.map(s => periodBar(s, wsKey))));
  }

  const grid = el('div', { class: 'cal-grid' },
    el('div', { class: 'cal-head' }, DAY_SHORT.map(d => el('div', { class: 'cal-dow', text: d }))),
    weeks);
  // En periode er én bjælke pr. uge. Peger man på én af dem (eller tabber til den), markeres alle ugers bjælker for samme opgave.
  const highlight = (bar, on) => {
    const id = bar.getAttribute('data-task');
    grid.querySelectorAll('.pbar').forEach(b => { if (b.getAttribute('data-task') === id) b.classList.toggle('hl', on); });
  };
  const barOf = e => (e.target.closest ? e.target.closest('.pbar') : null);
  grid.addEventListener('mouseover', e => { const b = barOf(e); if (b) highlight(b, true); });
  grid.addEventListener('mouseout', e => { const b = barOf(e); if (b && !b.contains(e.relatedTarget)) highlight(b, false); });
  grid.addEventListener('focusin', e => { const b = barOf(e); if (b) highlight(b, true); });
  grid.addEventListener('focusout', e => { const b = barOf(e); if (b) highlight(b, false); });
  const left = el('div', { class: 'cal-main' }, toolbar, legend, reqSummary, grid);
  const wrap = el('div', { class: 'cal-wrap' + (S.focusMember ? ' focus' : '') }, left, dayPanel(byDay));
  const nodes = [wrap];
  if (S.sheetOpen && S.selected && !S.multi) nodes.push(el('div', { class: 'sheet-back', onclick: closeSheet }));
  if (S.multi) nodes.push(multiBar());
  return nodes;
}

function changeMonth(delta) {
  S.month = new Date(S.month.getFullYear(), S.month.getMonth() + delta, 1);
  if (delta !== 0) { S.selected = null; S.sheetOpen = false; S.picked.clear(); }
  reload();
}

function onDay(key) {
  if (S.multi) {
    if (S.picked.has(key)) S.picked.delete(key); else S.picked.add(key);
    renderApp();
    return;
  }
  S.selected = key;
  S.form = newForm();
  S.sheetOpen = true;
  renderApp();
}
function closeSheet() { S.sheetOpen = false; renderApp(); }

function multiBar() {
  const n = S.picked.size;
  return el('div', { class: 'multibar', role: 'region', 'aria-label': 'Valgte dage' },
    el('span', { text: n === 0 ? 'Vælg dage i kalenderen' : `${n} ${n === 1 ? 'dag' : 'dage'} valgt` }),
    el('button', { type: 'button', class: 'btn primary', text: 'Skriv mig på', disabled: n === 0, onclick: bulkDialog }),
    el('button', { type: 'button', class: 'btn ghost', text: 'Annuller', onclick: () => { S.multi = false; S.picked.clear(); renderApp(); } }));
}

function newForm(memberId) {
  return { id: null, memberId: memberId || S.me.id, start: '08:00', end: '16:00', mode: (S.form && S.form.mode) || 'gulvvagt', note: '' };
}

function dayPanel(byDay) {
  const panel = el('aside', { class: 'panel' + (S.sheetOpen && S.selected && !S.multi ? ' open' : ''), 'aria-label': 'Valgt dag' });
  if (!S.selected) {
    panel.append(el('p', { class: 'panel-empty', text: isViewer() ? 'Vælg en dag for at se, hvem der kan bidrage, og for at oprette et ønske om støtte.' : 'Vælg en dag for at se, hvem der kan bidrage, og for at skrive dig på.' }));
    return panel;
  }
  const d = parseISO(S.selected);
  const items = byDay[S.selected] || [];
  const g = new Set(items.filter(a => a.mode === 'gulvvagt').map(a => a.member_id)).size;
  const k = new Set(items.filter(a => a.mode === 'kald').map(a => a.member_id)).size;

  panel.append(el('div', { class: 'panel-head' },
    el('div', {}, el('h2', { text: fmtLong(d) }), el('p', { class: 'sum', text: items.length ? countsText({ g, k }) : 'Ingen har meldt sig på denne dag.' })),
    el('button', { type: 'button', class: 'icon-btn panel-close', 'aria-label': 'Luk', text: '×', onclick: closeSheet })));

  const reqs = S.requests.filter(r => r.day === S.selected);
  const reqCard = r => {
    const cov = coverageOf(r, items);
    const st = reqState(r, cov);
    const nameOf = a => { const m = memberById(a.member_id); return `${m ? m.name : ''} ${rangeText(a)}`; };
    const gap = cov && cov.gaps[0];
    const by = memberById(r.created_by);
    const actions = [];
    if (gap && !isViewer()) {
      actions.push(el('button', { type: 'button', class: 'btn small primary', 'data-fk': 'rq-take-' + r.id,
        text: `Skriv mig på ${r.kind === 'stafet' ? 'til stafet' : 'som gulvvagt'} ${hourText(gap[0])}–${hourText(gap[1])}`, onclick: () => takeGap(gap, 'gulvvagt') }));
    }
    if (canEditReq(r)) {
      actions.push(el('button', { type: 'button', class: 'btn small', 'data-fk': 'rq-notify-' + r.id, text: 'Send besked', onclick: () => noticeChooser(r) }));
      actions.push(el('button', { type: 'button', class: 'btn small ghost', 'data-fk': 'rq-edit-' + r.id, text: 'Ret', onclick: () => requestDialog(r) }));
    }
    return el('div', { class: `rq ${st}` },
      el('div', { class: 'rq-head' },
        el('span', { class: 'rq-what', text: reqWhat(r) }),
        cov ? el('span', { class: 'rq-state', text: reqStateText(cov.state, r.kind) }) : null),
      r.note ? el('p', { class: 'rq-note', text: r.note }) : null,
      cov && cov.segs.length ? el('p', { class: 'rq-cover', text: (r.kind === 'stafet' ? 'Dækket af: ' : 'Gulvvagt: ') + cov.segs.map(nameOf).join(', ') }) : null,
      cov && cov.gaps.length ? el('p', { class: 'rq-cover', text: `Mangler ${r.kind === 'stafet' ? 'stafet' : 'gulvvagt'} ` + cov.gaps.map(g => `${hourText(g[0])}–${hourText(g[1])}`).join(', ') + '.' }) : null,
      by ? el('p', { class: 'rq-by', text: `Ønsket af ${by.name}` }) : null,
      actions.length ? el('div', { class: 'rq-actions' }, actions) : null);
  };
  const special = reqs.filter(isSpecial), other = reqs.filter(r => !isSpecial(r));
  if (special.length) {
    panel.append(el('section', { class: 'reqs' },
      el('h3', { text: special.length === 1 ? 'Særligt ønske om støtte fra driften' : 'Særlige ønsker om støtte fra driften' }),
      special.map(reqCard)));
  }
  if (other.length) {
    panel.append(el('section', { class: 'reqs' },
      el('h3', { text: other.length === 1 ? 'Øvrigt ønske om støtte' : 'Øvrige ønsker om støtte' }),
      other.map(reqCard)));
  }

  const people = activeMembers().filter(m => items.some(a => a.member_id === m.id));
  if (people.length) {
    panel.append(el('ul', { class: 'plist' }, people.map(m => el('li', { class: 'pers', vars: { '--c': colorOf(m.id) } },
      el('div', { class: 'pers-name' }, m.name, el('small', { text: ROLES[m.role] || '' })),
      items.filter(a => a.member_id === m.id).map(a => el('div', { class: 'slot' },
        el('span', { class: 'time', text: `${a.start}–${a.end}` }),
        el('span', { class: 'badge' }, el('span', { class: 'dot ' + (a.mode === 'gulvvagt' ? 'g' : 'k'), vars: { '--c': colorOf(m.id) } }), MODE_LABEL[a.mode]),
        !isViewer() && (S.me.is_admin || a.member_id === S.me.id) ? el('span', { class: 'slot-actions' },
          el('button', { type: 'button', class: 'btn small ghost', text: 'Ret', 'data-fk': 'edit-' + a.id, onclick: () => editSlot(a) }),
          el('button', { type: 'button', class: 'btn small ghost', text: 'Fjern', 'data-fk': 'del-' + a.id, onclick: () => removeSlot(a) })) : null,
        a.note ? el('span', { class: 'note', text: a.note }) : null))))));
  }
  const dayTasks = periodTasks().filter(t => t.start_date <= S.selected && t.end_date >= S.selected);
  if (dayTasks.length) {
    panel.append(el('div', { class: 'day-tasks' },
      el('h3', { text: dayTasks.length === 1 ? 'Opgave i perioden' : 'Opgaver i perioden' }),
      dayTasks.map(t => {
        const who = memberById(t.assignee_id);
        return el('button', { type: 'button', class: 'dt' + (t.priority === 'fast' ? ' fast' : ''), vars: { '--c': colorOf(t.assignee_id) },
          'data-fk': 'dt-' + t.id, onclick: () => taskDialog(t, t.assignee_id) },
          el('span', { class: 'dt-title', text: t.title }),
          el('span', { class: 'dt-meta', text: `${who ? who.name : ''} · ${periodText(t)} · ${PRIO_LABEL[t.priority]}` }));
      })));
  }
  panel.append(el('div', { class: 'req-add' },
    el('button', { type: 'button', class: 'btn small', 'data-fk': 'req-add', text: 'Tilføj ønske om støtte', onclick: () => requestDialog(null, S.selected) })));
  if (!isViewer()) panel.append(availForm());
  return panel;
}

// Fylder tilmeldingsformularen ud med det tidsrum, der mangler dækning
function takeGap(gap, mode) {
  S.form = Object.assign(newForm(), { start: gap[0], end: gap[1], mode: mode || 'gulvvagt' });
  S.sheetOpen = true;
  renderApp();
  const f = document.getElementById('avail-form');
  if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
}

// Alle kan oprette ønsker. Drift kan kun rette og slette egne.
const canEditReq = r => !isViewer() || (!!S.me && r.created_by === S.me.id);

function groupFieldset(selected, legend, hint) {
  return el('fieldset', { class: 'groups' },
    el('legend', { text: legend }),
    el('div', { class: 'group-row' }, REQ_GROUPS.map(([v, label]) => {
      const box = el('input', { type: 'checkbox', value: v, checked: selected.has(v) });
      box.addEventListener('change', () => { if (box.checked) selected.add(v); else selected.delete(v); });
      return el('label', { class: 'check' }, box, label);
    })),
    hint ? el('p', { class: 'hint', text: hint }) : null);
}

// Tilføj eller ret et ønske om støtte fra driften. Særligt ønske: Gulvvagt eller Stafet (begge med tidsrum). Øvrigt ønske: På kald eller administrative opgaver.
function requestDialog(req, day) {
  if (req && !canEditReq(req)) return;
  const other = !!req && !isSpecial(req);
  const st = req
    ? { day: req.day, group: other ? 'oevrigt' : req.kind, sub: other ? req.kind : 'kald', timed: !!req.start, start: req.start || '08:00', end: req.end || '16:00', note: req.note || '' }
    : { day, group: 'gulvvagt', sub: 'kald', timed: false, start: '08:00', end: '16:00', note: '' };
  const kindOf = () => st.group === 'oevrigt' ? st.sub : st.group;
  const groups = new Set();
  openDialog({
    title: req ? 'Ret ønske om støtte' : 'Tilføj ønske om støtte',
    build(body, dlg) {
      const err = el('p', { class: 'err', role: 'alert' });
      const submit = el('button', { type: 'submit', class: 'btn primary', text: req ? 'Gem' : 'Tilføj ønske' });
      const DATE_MIN = '2000-01-01', DATE_MAX = '2100-12-31';
      const dayIn = el('input', { type: 'date', id: 'rq-day', value: st.day, min: DATE_MIN, max: DATE_MAX, required: true, onchange: e => { st.day = e.target.value; } });
      const noteIn = el('textarea', { id: 'rq-note', maxlength: 300, oninput: e => { st.note = e.target.value; } }, st.note);
      const noteText = () => kindOf() === 'admin' ? 'Hvad drejer det sig om?' : 'Bemærkning (valgfri)';
      const noteLbl = el('label', { for: 'rq-note', text: noteText() });
      // Gulvvagt, Stafet og På kald skal have et tidsrum. Administrative opgaver kan have et, men behøver det ikke.
      // Stafet foreslår aftentidsrummet 16-21, så længe tidsrummet ikke er rettet.
      const needsTime = () => timeRequired(kindOf());
      const suggestTimes = () => {
        if (kindOf() === 'stafet' && st.start === '08:00' && st.end === '16:00') { st.start = '16:00'; st.end = '21:00'; st.auto = true; }
        else if (kindOf() !== 'stafet' && st.auto && st.start === '16:00' && st.end === '21:00') { st.start = '08:00'; st.end = '16:00'; st.auto = false; }
      };
      const timedBox = el('input', { type: 'checkbox', id: 'rq-timed', checked: st.timed });
      timedBox.addEventListener('change', () => { st.timed = timedBox.checked; draw(); });
      const timedRow = el('label', { class: 'check', for: 'rq-timed' }, timedBox, 'Angiv tidsrum (valgfrit)');
      const pick = el('div', { class: 'time-pick' });
      const draw = () => {
        timedRow.hidden = needsTime();
        if (!(needsTime() || st.timed)) { pick.replaceChildren(); return; }
        const startSel = selectEl(TIMES, st.start, v => { st.start = v; }, { 'aria-label': 'Fra klokken' });
        const endSel = selectEl(END_TIMES, st.end, v => { st.end = v; }, { 'aria-label': 'Til klokken' });
        pick.replaceChildren(
          el('div', { class: 'row' }, el('div', { class: 'field' }, startSel), el('div', { class: 'field' }, endSel)),
          el('div', { class: 'presets' }, PRESETS.map(([label, a, b]) => el('button', {
            type: 'button', class: 'btn small', text: label,
            onclick: () => { st.start = a; st.end = b; startSel.value = a; endSel.value = b; },
          }))));
      };
      const refresh = () => { err.textContent = ''; noteLbl.textContent = noteText(); suggestTimes(); draw(); };
      const subField = el('div', { class: 'field' }, el('span', { class: 'lbl', id: 'rq-sub-lbl', text: 'Øvrigt ønske om støtte til' }),
        segmented('rq-sub', [['kald', 'På kald'], ['admin', 'Administrative opgaver']], st.sub, v => { st.sub = v; refresh(); }));
      subField.hidden = st.group !== 'oevrigt';
      subField.lastChild.setAttribute('aria-labelledby', 'rq-sub-lbl');
      const kindSeg = segmented('rq-kind', [['gulvvagt', 'Gulvvagt'], ['stafet', 'Stafet'], ['oevrigt', 'Øvrigt ønske']], st.group, v => { st.group = v; subField.hidden = v !== 'oevrigt'; refresh(); });
      kindSeg.setAttribute('aria-labelledby', 'rq-kind-lbl');
      draw();
      let armed = false;
      const del = req ? el('button', { type: 'button', class: 'btn danger spacer', text: 'Slet ønske' }) : null;
      if (del) del.addEventListener('click', async () => {
        if (!armed) { armed = true; del.classList.add('armed'); del.textContent = 'Bekræft sletning'; return; }
        del.disabled = true;
        const r = await api('request_delete', { id: req.id });
        if (!r.ok) { del.disabled = false; err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
        dlg.close(); toast('Ønske slettet'); reload();
      });
      const form = el('form', { class: 'dlg-body', style: 'padding:0', novalidate: true },
        el('div', { class: 'field' }, el('label', { for: 'rq-day', text: 'Dato' }), dayIn),
        el('div', { class: 'field' }, el('span', { class: 'lbl', id: 'rq-kind-lbl', text: 'Der ønskes støtte som' }), kindSeg),
        subField,
        el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Tidsrum' }), timedRow, pick),
        el('div', { class: 'field' }, noteLbl, noteIn),
        req ? null : groupFieldset(groups, 'Send besked om ønsket til (valgfrit)', 'Når du har gemt, åbnes en mail til de valgte med tekst og modtagere udfyldt. Du sender den selv.'),
        err,
        el('div', { class: 'dlg-actions' }, del, el('button', { type: 'button', class: 'btn', text: 'Annuller', onclick: () => dlg.close() }), submit));
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (!st.day) { err.textContent = 'Vælg en dato.'; dayIn.focus(); return; }
        const kind = kindOf();
        const withTime = needsTime() || st.timed;
        if (withTime && st.end <= st.start) { err.textContent = 'Sluttidspunktet skal være efter starttidspunktet.'; return; }
        if (kind === 'admin' && !st.note.trim()) { err.textContent = 'Skriv kort, hvad den administrative opgave drejer sig om.'; noteIn.focus(); return; }
        submit.disabled = true;
        const payload = { day: st.day, kind, start: withTime ? st.start : '', end: withTime ? st.end : '', note: st.note };
        const r = req ? await api('request_update', Object.assign({ id: req.id }, payload)) : await api('request_add', payload);
        submit.disabled = false;
        if (!r.ok) { err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
        dlg.close();
        toast(req ? 'Ændring gemt' : 'Ønske tilføjet');
        S.selected = st.day; S.month = startOfMonth(parseISO(st.day)); S.sheetOpen = true;
        await reload();
        if (!req && groups.size) {
          const saved = S.requests.find(x => x.id === r.id)
            || { id: r.id, day: st.day, kind, start: withTime ? st.start : null, end: withTime ? st.end : null, note: st.note.trim() || null, created_by: S.me.id };
          sendNotice(saved, [...groups]);
        }
      });
      body.append(form);
      setTimeout(() => dayIn.focus(), 0);
    },
  });
}

// Vælg grupper at sende besked til om et eksisterende ønske
function noticeChooser(req) {
  const groups = new Set();
  openDialog({
    title: 'Send besked om ønsket',
    build(body, dlg) {
      const err = el('p', { class: 'err', role: 'alert' });
      const go = el('button', { type: 'submit', class: 'btn primary', text: 'Fortsæt' });
      const form = el('form', { class: 'dlg-body', style: 'padding:0', novalidate: true },
        el('p', { text: `${fmtLong(parseISO(req.day))}: ${reqWhat(req)}` }),
        groupFieldset(groups, 'Send til', 'Der åbnes en mail til de valgte med tekst og modtagere udfyldt. Du sender den selv.'),
        err,
        el('div', { class: 'dlg-actions' }, el('button', { type: 'button', class: 'btn', text: 'Annuller', onclick: () => dlg.close() }), go));
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (!groups.size) { err.textContent = 'Vælg mindst én gruppe.'; return; }
        go.disabled = true;
        dlg.close();
        sendNotice(req, [...groups]);
      });
      body.append(form);
    },
  });
}

async function sendNotice(req, groups) {
  const r = await api('request_notify', { id: req.id, groups });
  if (!r.ok) return toast(r.error || 'Det lykkedes ikke. Prøv igen.', true);
  if (!r.recipients.length) return toast('Der er ingen andre i de valgte grupper at sende til.', true);
  noticeDialog(req, r.recipients);
}

// Mailen til de valgte grupper. Den sendes fra brugerens eget mailprogram, så teksten kan læses igennem først.
function noticeDialog(req, recipients) {
  const when = fmtLong(parseISO(req.day));
  const cov = coverageOf(req, S.avail.filter(a => a.day === req.day));
  const lines = ['Hej,', '', `${S.me.name} har oprettet et ønske om støtte fra driften:`, '', `${when}: ${reqWhat(req)}`];
  if (req.note) lines.push(`Bemærkning: ${req.note}`);
  if (cov) lines.push('Status: ' + reqStateText(cov.state, req.kind) + (cov.gaps.length ? ' ' + cov.gaps.map(g => `${hourText(g[0])}–${hourText(g[1])}`).join(', ') : ''));
  lines.push('', 'Se ønsket og skriv dig på i driftskalenderen:', location.origin + location.pathname, '', 'Venlig hilsen', S.me.name);
  const text = lines.join('\n');
  const subject = `Ønske om støtte fra driften: ${reqKindLabel(req.kind)} ${when}`;
  const emails = recipients.map(x => x.email).join(', ');
  const href = `mailto:${recipients.map(x => x.email).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text.replace(/\n/g, '\r\n'))}`;
  openDialog({
    title: 'Send besked om ønsket',
    build(body, dlg) {
      const copyBtn = (label, value, done) => {
        const b = el('button', { type: 'button', class: 'btn', text: label });
        b.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(value); b.textContent = done; } catch (e) { toast('Markér teksten og kopier den selv.', true); }
        });
        return b;
      };
      body.append(
        el('p', { text: 'Beskeden sendes fra dit eget mailprogram, så du kan læse den igennem først. Åbner mailprogrammet ikke, så kopier adresserne og teksten.' }),
        el('p', { class: 'notice-to' }, el('b', { text: 'Til: ' }), recipients.map(x => `${x.name} (${ROLES[x.role] || x.role})`).join(', ')),
        el('div', { class: 'mailbox', text: `Emne: ${subject}\n\n${text}` }),
        el('div', { class: 'dlg-actions' },
          el('button', { type: 'button', class: 'btn', text: 'Luk', onclick: () => dlg.close() }),
          copyBtn('Kopier adresser', emails, 'Kopieret'),
          copyBtn('Kopier tekst', text, 'Kopieret'),
          el('a', { class: 'btn primary', href, text: 'Åbn i mail' })));
    },
  });
}

function editSlot(a) {
  S.form = { id: a.id, memberId: a.member_id, start: a.start, end: a.end, mode: a.mode, note: a.note || '' };
  S.sheetOpen = true;
  renderApp();
  const f = document.getElementById('avail-form');
  if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
}

async function removeSlot(a) {
  const r = await api('avail_delete', { id: a.id });
  if (!r.ok) return toast(r.error, true);
  toast('Tidsrum fjernet');
  if (S.form && S.form.id === a.id) S.form = newForm();
  reload();
}

function selectEl(options, value, onchange, attrs) {
  const s = el('select', attrs || {}, options.map(v => el('option', { value: v, text: v })));
  s.value = value;
  s.addEventListener('change', () => onchange(s.value));
  return s;
}

function segmented(name, options, value, onchange) {
  return el('div', { class: 'seg', role: 'radiogroup' }, options.map(([v, label, kind, pip]) => {
    const id = `${name}-${v}`;
    const input = el('input', { type: 'radio', name, id, value: v, checked: v === value });
    input.addEventListener('change', () => { if (input.checked) onchange(v); });
    return el('label', { for: id, class: 'seg-opt ' + (kind || '') },
      input, el('span', {}, pip === undefined ? null : el('i', { class: 'pip' + (pip ? ' fill' : '') }), label));
  }));
}

function availFields(st, prefix, memberChoice) {
  const startSel = selectEl(TIMES, st.start, v => { st.start = v; }, { 'aria-label': 'Fra klokken' });
  const endSel = selectEl(END_TIMES, st.end, v => { st.end = v; }, { 'aria-label': 'Til klokken' });
  const nodes = [];
  if (memberChoice) {
    const sel = el('select', { id: prefix + '-who' }, activeMembers().map(m => el('option', { value: m.id, text: m.name + (m.id === S.me.id ? ' (dig)' : '') })));
    sel.value = st.memberId;
    sel.addEventListener('change', () => { st.memberId = sel.value; });
    nodes.push(el('div', { class: 'field' }, el('label', { for: prefix + '-who', text: 'Skriv på for' }), sel));
  }
  nodes.push(
    el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Tidsrum' }),
      el('div', { class: 'row' },
        el('div', { class: 'field' }, startSel), el('div', { class: 'field' }, endSel)),
      el('div', { class: 'presets' }, PRESETS.map(([label, a, b]) => el('button', {
        type: 'button', class: 'btn small', text: label,
        onclick: () => { st.start = a; st.end = b; startSel.value = a; endSel.value = b; },
      })))),
    el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Jeg stiller op som' }),
      segmented(prefix + '-mode', [['gulvvagt', 'Gulvvagt', 'g', true], ['kald', 'På kald', 'k', false]], st.mode, v => { st.mode = v; })),
    el('div', { class: 'field' }, el('label', { for: prefix + '-note', text: 'Bemærkning (valgfri)' }),
      el('input', { type: 'text', id: prefix + '-note', maxlength: 200, value: st.note, placeholder: 'fx kan rykke ud ved behov', oninput: e => { st.note = e.target.value; } })));
  return nodes;
}

function availForm() {
  const st = S.form || (S.form = newForm());
  const err = el('p', { class: 'err', role: 'alert', id: 'avail-err' });
  const submit = el('button', { type: 'submit', class: 'btn primary', text: st.id ? 'Gem ændring' : 'Tilføj tidsrum' });
  const form = el('form', { class: 'form-block', id: 'avail-form', novalidate: true },
    el('h3', { text: st.id ? 'Ret tidsrum' : 'Skriv dig på' }),
    availFields(st, 'panel', S.me.is_admin),
    err,
    el('div', { class: 'row' }, submit,
      st.id ? el('button', { type: 'button', class: 'btn', text: 'Annuller', onclick: () => { S.form = newForm(); renderApp(); } }) : null));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (st.end <= st.start) { err.textContent = 'Sluttidspunktet skal være efter starttidspunktet.'; return; }
    err.textContent = '';
    submit.disabled = true;
    const payload = { start: st.start, end: st.end, mode: st.mode, note: st.note };
    const r = st.id
      ? await api('avail_update', Object.assign({ id: st.id }, payload))
      : await api('avail_add', Object.assign({ day: S.selected, member_id: st.memberId }, payload));
    submit.disabled = false;
    if (!r.ok) { err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
    toast(st.id ? 'Ændring gemt' : 'Tidsrum tilføjet');
    S.form = newForm(S.me.is_admin ? st.memberId : undefined);
    S.form.mode = st.mode;
    reload();
  });
  return form;
}

function bulkDialog() {
  const days = [...S.picked].sort();
  const st = { memberId: S.me.id, start: '08:00', end: '16:00', mode: (S.form && S.form.mode) || 'gulvvagt', note: '' };
  openDialog({
    title: `Skriv dig på ${days.length} ${days.length === 1 ? 'dag' : 'dage'}`,
    build(body, dlg) {
      const err = el('p', { class: 'err', role: 'alert' });
      const submit = el('button', { type: 'submit', class: 'btn primary', text: 'Skriv på' });
      const form = el('form', { class: 'dlg-body', style: 'padding:0', novalidate: true },
        el('ul', { class: 'daylist', 'aria-label': 'Valgte dage' }, days.map(k => el('li', { text: fmtShort(parseISO(k)) }))),
        availFields(st, 'bulk', S.me.is_admin),
        err,
        el('div', { class: 'dlg-actions' },
          el('button', { type: 'button', class: 'btn', text: 'Annuller', onclick: () => dlg.close() }), submit));
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (st.end <= st.start) { err.textContent = 'Sluttidspunktet skal være efter starttidspunktet.'; return; }
        submit.disabled = true;
        const r = await api('avail_bulk', { days, member_id: st.memberId, start: st.start, end: st.end, mode: st.mode, note: st.note });
        submit.disabled = false;
        if (!r.ok) { err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
        dlg.close();
        S.multi = false; S.picked.clear();
        if (S.form) S.form.mode = st.mode;
        toast(`Tilføjet på ${r.added} ${r.added === 1 ? 'dag' : 'dage'}` + (r.skipped ? `, ${r.skipped} sprunget over fordi tidsrummet overlapper` : ''));
        reload();
      });
      body.append(form);
    },
  });
}

/* ---------- Opgaver ---------- */
function viewTasks() {
  const me = S.me.id;
  let people = activeMembers().slice().sort((a, b) => (a.id === me ? -1 : 0) - (b.id === me ? -1 : 0));
  if (S.onlyMine && !isViewer()) people = people.filter(m => m.id === me);
  const doneCount = S.tasks.filter(t => t.done).length;
  // Sorteret efter det tidspunkt opgaven først kræver noget: deadline, eller periodens start. Uden tid til sidst.
  const when = t => t.due_date || t.start_date || '9999';
  const cmp = (a, b) => when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : (a.created_at < b.created_at ? -1 : 1);

  const head = el('div', { class: 'page-head' },
    el('h1', { text: 'Opgaver' }),
    el('div', { class: 'tools' },
      isViewer() ? null : el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: S.onlyMine, 'data-fk': 'only-mine', onchange: e => { S.onlyMine = e.target.checked; renderApp(); } }), 'Kun mine'),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: S.showDone, 'data-fk': 'show-done', onchange: e => { S.showDone = e.target.checked; renderApp(); } }), `Vis udførte (${doneCount})`)));

  const cols = people.map(m => {
    const mine = S.tasks.filter(t => t.assignee_id === m.id);
    const open = mine.filter(t => !t.done);
    const fast = open.filter(t => t.priority === 'fast').sort(cmp);
    const flex = open.filter(t => t.priority !== 'fast').sort(cmp);
    const done = mine.filter(t => t.done).sort((a, b) => (a.done_at < b.done_at ? 1 : -1));
    const group = (label, kind, list) => el('section', { class: 'group', 'aria-label': label },
      el('h3', { class: 'group-h' }, el('span', { class: 'flag' + (kind === 'soft' ? ' soft' : '') }), label, el('span', { class: 'n', text: String(list.length) })),
      list.length ? el('ul', { class: 'tasks' }, list.map(taskRow)) : el('p', { class: 'none-yet', text: 'Ingen opgaver her.' }));
    return el('section', { class: 'person', vars: { '--c': colorOf(m.id) }, 'aria-label': `Opgaver for ${m.name}` },
      el('div', { class: 'person-head' },
        el('h2', { text: m.name }),
        el('span', { class: 'role', text: m.id === me ? `${ROLES[m.role] || ''} (dig)` : (ROLES[m.role] || '') })),
      group(PRIO_LABEL.fast, 'fast', fast),
      group(PRIO_LABEL.fleksibel, 'soft', flex),
      S.showDone && done.length ? el('section', { class: 'group', 'aria-label': 'Udførte opgaver' },
        el('h3', { class: 'group-h' }, 'Udført', el('span', { class: 'n', text: String(done.length) })),
        el('ul', { class: 'tasks' }, done.map(taskRow))) : null,
      isViewer() ? null : el('div', {}, el('button', { type: 'button', class: 'btn small', text: 'Tilføj opgave', 'data-fk': 'add-' + m.id, onclick: () => taskDialog(null, m.id) })));
  });
  return [head, cols.length ? el('div', { class: 'people' }, cols) : el('p', { class: 'loading', text: 'Ingen medarbejdere at vise.' })];
}

// Dato uden år i indeværende år, ellers med år, så en deadline i næste år ikke misforstås.
const fmtTaskDate = s => {
  const d = parseISO(s);
  return d.getFullYear() === new Date().getFullYear() ? fmtShort(d) : `${fmtShort(d)} ${d.getFullYear()}`;
};

const periodText = t => t.start_date === t.end_date ? fmtTaskDate(t.start_date) : `${fmtTaskDate(t.start_date)} – ${fmtTaskDate(t.end_date)}`;

// Åbne opgaver med periode hos aktive medarbejdere: dem der tegnes som bjælker i kalenderen og vises i dagspanelet.
function periodTasks() {
  const active = new Set(activeMembers().map(m => m.id));
  return S.tasks
    .filter(t => t.start_date && t.end_date && !t.done && active.has(t.assignee_id))
    .sort((a, b) => a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1
      : a.end_date > b.end_date ? -1 : a.end_date < b.end_date ? 1 : (a.created_at < b.created_at ? -1 : 1));
}

// Opgavens tid som tekst: enten en deadline eller en periode (fra og til). Begge er valgfri.
function taskWhen(t) {
  const today = todayISO();
  if (t.start_date && t.end_date) {
    const range = periodText(t);
    const late = !t.done && t.end_date < today;
    const now = !t.done && t.start_date <= today && today <= t.end_date;
    return { late, text: (late ? 'Overskredet: ' : 'Periode ') + range + (now ? ' (i gang)' : '') };
  }
  if (t.due_date) {
    const late = !t.done && t.due_date < today;
    return { late, text: (late ? 'Overskredet: ' : 'Deadline ') + fmtTaskDate(t.due_date) };
  }
  return null;
}

function taskRow(t) {
  const w = taskWhen(t);
  const box = el('input', { type: 'checkbox', checked: t.done, disabled: isViewer(), 'aria-label': isViewer() ? (t.done ? `"${t.title}" er udført` : `"${t.title}" er ikke udført`) : `Markér "${t.title}" som udført`, 'data-fk': 'chk-' + t.id });
  box.addEventListener('change', () => toggleTask(t, box.checked));
  return el('li', { class: `task ${t.priority}` + (t.done ? ' done' : '') },
    box,
    el('button', { type: 'button', class: 'task-main', 'data-fk': 'task-' + t.id, onclick: () => taskDialog(t, t.assignee_id) },
      el('span', { class: 'task-title', text: t.title }),
      (w || t.done) ? el('span', { class: 'task-meta' },
        w ? el('span', { class: 'due' + (w.late ? ' late' : ''), text: w.text }) : null,
        t.done && t.done_at ? el('span', { text: 'Udført ' + fmtShort(new Date(t.done_at)) }) : null) : null,
      t.details ? el('span', { class: 'task-details', text: t.details }) : null));
}

async function toggleTask(t, done) {
  if (isViewer()) return;
  const before = { done: t.done, done_at: t.done_at };
  t.done = done; t.done_at = done ? new Date().toISOString() : null;
  renderApp();
  const r = await api('task_toggle', { id: t.id, done });
  if (!r.ok) {
    t.done = before.done; t.done_at = before.done_at;
    renderApp();
    return toast(r.error || 'Det lykkedes ikke. Prøv igen.', true);
  }
  S.sig = '';
  reload();
}

// Skrivebeskyttet opgavevisning til Drift: samme oplysninger, ingen felter at rette i og ingen knapper der ændrer noget.
function taskView(task) {
  const who = memberById(task.assignee_id);
  const w = taskWhen(task);
  const fact = (label, value) => [el('dt', { text: label }), el('dd', { text: value })];
  openDialog({
    title: task.title,
    build(body, dlg) {
      body.append(
        el('dl', { class: 'facts' },
          fact('Prioritet', PRIO_LABEL[task.priority] || ''),
          fact('Ansvarlig', who ? who.name : ''),
          w ? fact('Tid', w.text) : null,
          fact('Status', task.done ? 'Udført' + (task.done_at ? ' ' + fmtShort(new Date(task.done_at)) : '') : 'Ikke udført'),
          task.details ? fact('Beskrivelse', task.details) : null),
        el('div', { class: 'dlg-actions' }, el('button', { type: 'button', class: 'btn primary', text: 'Luk', onclick: () => dlg.close() })));
    },
  });
}

function taskDialog(task, assigneeId) {
  if (isViewer()) { if (task) taskView(task); return; }
  // Tid er valgfri: ingen, en deadline eller en periode (fra og til), aldrig begge.
  const st = task
    ? { title: task.title, details: task.details || '', priority: task.priority, assignee: task.assignee_id,
        mode: task.start_date ? 'periode' : task.due_date ? 'deadline' : 'ingen',
        due: task.due_date || '', from: task.start_date || '', to: task.end_date || '' }
    : { title: '', details: '', priority: 'fleksibel', assignee: assigneeId, mode: 'ingen', due: '', from: '', to: '' };
  openDialog({
    title: task ? 'Ret opgave' : 'Tilføj opgave',
    build(body, dlg) {
      const err = el('p', { class: 'err', role: 'alert' });
      const submit = el('button', { type: 'submit', class: 'btn primary', text: task ? 'Gem' : 'Tilføj opgave' });
      const who = el('select', { id: 'task-who' }, activeMembers().map(m => el('option', { value: m.id, text: m.name })));
      who.value = st.assignee;
      who.addEventListener('change', () => { st.assignee = who.value; });
      const title = el('input', { type: 'text', id: 'task-title', maxlength: 200, value: st.title, required: true, oninput: e => { st.title = e.target.value; } });
      const DATE_MIN = '2000-01-01', DATE_MAX = '2100-12-31';
      const timeBox = el('div', { class: 'time-box' });
      const drawTime = () => {
        if (st.mode === 'deadline') {
          timeBox.replaceChildren(el('div', { class: 'field' }, el('label', { for: 'task-due', text: 'Deadline' }),
            el('input', { type: 'date', id: 'task-due', value: st.due, min: DATE_MIN, max: DATE_MAX, onchange: e => { st.due = e.target.value; } })));
        } else if (st.mode === 'periode') {
          const from = el('input', { type: 'date', id: 'task-from', value: st.from, min: DATE_MIN, max: DATE_MAX });
          const to = el('input', { type: 'date', id: 'task-to', value: st.to, min: st.from || DATE_MIN, max: DATE_MAX });
          from.addEventListener('change', () => {
            st.from = from.value;
            // Vælger man fra-dato først, foreslås samme dag som til-dato (en periode på én dag), som man kan flytte.
            if (st.from && (!st.to || st.to < st.from)) { st.to = st.from; to.value = st.to; }
            to.min = st.from || DATE_MIN;
          });
          to.addEventListener('change', () => { st.to = to.value; });
          timeBox.replaceChildren(el('div', { class: 'row' },
            el('div', { class: 'field' }, el('label', { for: 'task-from', text: 'Fra' }), from),
            el('div', { class: 'field' }, el('label', { for: 'task-to', text: 'Til' }), to)));
        } else {
          timeBox.replaceChildren();
        }
      };
      const timeSeg = segmented('task-time', [['ingen', 'Ingen'], ['deadline', 'Deadline'], ['periode', 'Periode']], st.mode, v => { st.mode = v; err.textContent = ''; drawTime(); });
      timeSeg.setAttribute('aria-labelledby', 'task-time-lbl');
      drawTime();
      let armed = false;
      const del = task ? el('button', { type: 'button', class: 'btn danger spacer', text: 'Slet opgave' }) : null;
      if (del) del.addEventListener('click', async () => {
        if (!armed) { armed = true; del.classList.add('armed'); del.textContent = 'Bekræft sletning'; return; }
        del.disabled = true;
        const r = await api('task_delete', { id: task.id });
        if (!r.ok) { del.disabled = false; err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
        dlg.close(); toast('Opgave slettet'); reload();
      });
      const form = el('form', { class: 'dlg-body', style: 'padding:0', novalidate: true },
        el('div', { class: 'field' }, el('label', { for: 'task-title', text: 'Opgave' }), title),
        el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Prioritet' }),
          segmented('task-prio', [['fast', PRIO_LABEL.fast, 'fast'], ['fleksibel', PRIO_LABEL.fleksibel, '']], st.priority, v => { st.priority = v; })),
        el('div', { class: 'field' }, el('label', { for: 'task-who', text: 'Ansvarlig' }), who),
        el('div', { class: 'field' }, el('span', { class: 'lbl', id: 'task-time-lbl', text: 'Tid (valgfri)' }), timeSeg, timeBox),
        el('div', { class: 'field' }, el('label', { for: 'task-details', text: 'Beskrivelse (valgfri)' }),
          el('textarea', { id: 'task-details', maxlength: 2000, oninput: e => { st.details = e.target.value; } }, st.details)),
        err,
        el('div', { class: 'dlg-actions' }, del, el('button', { type: 'button', class: 'btn', text: 'Annuller', onclick: () => dlg.close() }), submit));
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (!st.title.trim()) { err.textContent = 'Opgaven skal have en titel.'; title.focus(); return; }
        // Kun det valgte tidsfelt sendes; de andre ryddes, så en opgave aldrig har både deadline og periode.
        const time = { due_date: '', start_date: '', end_date: '' };
        if (st.mode === 'deadline') {
          if (!st.due) { err.textContent = 'Vælg en deadline, eller vælg Ingen.'; return; }
          time.due_date = st.due;
        } else if (st.mode === 'periode') {
          if (!st.from || !st.to) { err.textContent = 'Vælg både fra og til, eller vælg Ingen.'; return; }
          if (st.to < st.from) { err.textContent = 'Til-datoen må ikke ligge før fra-datoen.'; return; }
          time.start_date = st.from; time.end_date = st.to;
        }
        submit.disabled = true;
        const payload = Object.assign({ title: st.title, details: st.details, priority: st.priority, assignee_id: st.assignee }, time);
        const r = task ? await api('task_update', Object.assign({ id: task.id }, payload)) : await api('task_add', payload);
        submit.disabled = false;
        if (!r.ok) { err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
        dlg.close(); toast(task ? 'Ændring gemt' : 'Opgave tilføjet'); reload();
      });
      body.append(form);
      setTimeout(() => title.focus(), 0);
    },
  });
}

/* ---------- Medarbejdere (administrator ændrer, Drift kan kun se) ---------- */
function viewMembersReadOnly() {
  const people = S.members.filter(m => m.active);
  const rows = people.map(m => el('li', { class: 'mrow ro' },
    el('div', { class: 'm-name', vars: { '--c': colorOf(m.id) } }, el('span', { class: 'sw' }), el('b', { text: m.name + (m.id === S.me.id ? ' (dig)' : '') })),
    el('div', { class: 'm-status', text: ROLES[m.role] || '' })));
  return [
    el('div', { class: 'page-head' }, el('h1', { text: 'Medarbejdere' })),
    rows.length ? el('ul', { class: 'mlist' }, rows) : el('p', { class: 'loading', text: 'Ingen medarbejdere at vise.' })];
}

function viewMembers() {
  if (!S.me.is_admin) return viewMembersReadOnly();
  const head = el('div', { class: 'page-head' },
    el('h1', { text: 'Medarbejdere' }),
    el('div', { class: 'tools' }, el('button', { type: 'button', class: 'btn primary', text: 'Inviter medarbejder', 'data-fk': 'invite', onclick: inviteDialog })));
  const fmtDate = s => new Date(s).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
  const rows = S.members.map(m => {
    const self = m.id === S.me.id;
    const status = !m.active ? 'Deaktiveret'
      : m.invited ? (m.invite_pending ? 'Inviteret, har ikke oprettet adgang endnu' : 'Invitationen er udløbet')
      : (m.last_login ? `Aktiv, sidst logget ind ${fmtDate(m.last_login)}` : 'Aktiv');
    const roleSel = el('select', { 'aria-label': `Rolle for ${m.name}` }, Object.entries(ROLES).map(([v, l]) => el('option', { value: v, text: l })));
    roleSel.value = m.role;
    roleSel.addEventListener('change', async () => { const r = await api('member_update', { id: m.id, role: roleSel.value }); toast(r.ok ? 'Rolle ændret' : r.error, !r.ok); reload(); });
    const adm = el('input', { type: 'checkbox', checked: m.is_admin, disabled: self || m.role === 'drift' });
    adm.addEventListener('change', async () => { const r = await api('member_update', { id: m.id, is_admin: adm.checked }); toast(r.ok ? 'Gemt' : r.error, !r.ok); reload(); });
    return el('li', { class: 'mrow' + (m.active ? '' : ' off') },
      el('div', { class: 'm-name', vars: { '--c': colorOf(m.id) } }, el('span', { class: 'sw' }),
        el('div', {}, el('b', { text: m.name + (self ? ' (dig)' : '') }), el('small', { text: (m.email || 'Ikke oprettet endnu') + (m.role === 'drift' ? ' · kun læseadgang' : '') }))),
      el('div', { class: 'm-status', text: status }),
      el('div', { class: 'm-actions' },
        roleSel,
        el('label', { class: 'check' }, adm, 'Administrator'),
        self ? null : el('button', { type: 'button', class: 'btn small', text: 'Nyt invitationslink', onclick: () => reinvite(m) }),
        self ? null : el('button', { type: 'button', class: 'btn small' + (m.active ? ' danger' : ''), text: m.active ? 'Deaktiver' : 'Aktiver',
          onclick: async () => { const r = await api('member_update', { id: m.id, active: !m.active }); toast(r.ok ? (m.active ? 'Deaktiveret' : 'Aktiveret') : r.error, !r.ok); reload(); } })));
  });
  return [head, el('ul', { class: 'mlist' }, rows)];
}

function inviteLink(token) {
  return location.origin + location.pathname + '#invite=' + token;
}

function inviteDialog() {
  const st = { name: '', email: '', role: 'teamleder', admin: false };
  openDialog({
    title: 'Inviter medarbejder',
    build(body, dlg) {
      const err = el('p', { class: 'err', role: 'alert' });
      const submit = el('button', { type: 'submit', class: 'btn primary', text: 'Opret invitation' });
      const role = el('select', { id: 'inv-role' }, Object.entries(ROLES).map(([v, l]) => el('option', { value: v, text: v === 'drift' ? 'Drift (kun læseadgang)' : l })));
      const adminBox = el('input', { type: 'checkbox', id: 'inv-admin', onchange: e => { st.admin = e.target.checked; } });
      const roleHint = el('span', { class: 'hint', id: 'inv-role-hint', text: '' });
      role.addEventListener('change', () => {
        st.role = role.value;
        // Drift kan se alt, men ikke ændre noget, og kan derfor ikke være administrator.
        const viewer = st.role === 'drift';
        if (viewer) { st.admin = false; adminBox.checked = false; }
        adminBox.disabled = viewer;
        roleHint.textContent = viewer ? 'Kan se kalender, opgaver og medarbejdere, men ikke ændre noget.' : '';
      });
      const form = el('form', { class: 'dlg-body', style: 'padding:0', novalidate: true },
        el('div', { class: 'field' }, el('label', { for: 'inv-name', text: 'Navn' }), el('input', { type: 'text', id: 'inv-name', maxlength: 80, autocomplete: 'off', oninput: e => { st.name = e.target.value; } })),
        el('div', { class: 'field' }, el('label', { for: 'inv-email', text: 'E-mail' }), el('input', { type: 'email', id: 'inv-email', autocomplete: 'off', oninput: e => { st.email = e.target.value; } })),
        el('div', { class: 'field' }, el('label', { for: 'inv-role', text: 'Rolle' }), role, roleHint),
        el('label', { class: 'check' }, adminBox, 'Giv administratorrettigheder'),
        err,
        el('div', { class: 'dlg-actions' }, el('button', { type: 'button', class: 'btn', text: 'Annuller', onclick: () => dlg.close() }), submit));
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        submit.disabled = true;
        const r = await api('member_invite', { name: st.name, email: st.email, role: st.role, is_admin: st.admin });
        submit.disabled = false;
        if (!r.ok) { err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
        dlg.close();
        await reload();
        linkDialog(st.name.trim(), st.email.trim(), r.invite, st.role);
      });
      body.append(form);
      setTimeout(() => $('#inv-name') && $('#inv-name').focus(), 0);
    },
  });
}

function reinvite(m) {
  openDialog({
    title: 'Nyt invitationslink',
    build(body, dlg) {
      const err = el('p', { class: 'err', role: 'alert' });
      const go1 = el('button', { type: 'button', class: 'btn primary', text: 'Lav nyt link' });
      go1.addEventListener('click', async () => {
        go1.disabled = true;
        const r = await api('member_reinvite', { id: m.id });
        if (!r.ok) { go1.disabled = false; err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
        dlg.close();
        await reload();
        linkDialog(m.name, m.email || '', r.invite, m.role);
      });
      body.append(
        el('p', { text: `${m.name} bliver logget ud, og den nuværende adgangskode virker ikke længere. Personen vælger en ny adgangskode via det nye link. Brug det også, hvis en adgangskode er glemt.` }),
        err,
        el('div', { class: 'dlg-actions' }, el('button', { type: 'button', class: 'btn', text: 'Annuller', onclick: () => dlg.close() }), go1));
    },
  });
}

function linkDialog(name, email, token, role) {
  const link = inviteLink(token);
  const first = (name || '').split(' ')[0] || 'du';
  const subject = 'Invitation til Driftskalender';
  const what = role === 'drift'
    ? 'hvor du kan se, hvem der kan bidrage i driften, og hvilke opgaver der ligger. Du har læseadgang og kan ikke ændre noget.'
    : 'hvor vi skriver os på driften og holder styr på opgaverne.';
  const text = `Hej ${first},\n\nDu er inviteret til Driftskalender, ${what} Åbn linket for at oprette din adgang (gælder i 14 dage):\n\n${link}\n\nVenlig hilsen\n${S.me.name}`;
  openDialog({
    title: 'Send linket til ' + (name || 'medarbejderen'),
    build(body, dlg) {
      const copy = el('button', { type: 'button', class: 'btn primary', text: 'Kopier link' });
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(link); copy.textContent = 'Kopieret'; } catch (e) { toast('Markér linket og kopier det selv.', true); }
      });
      body.append(
        el('p', { text: 'Linket gælder i 14 dage og kan kun bruges én gang. Det vises kun her, så send det nu.' }),
        el('div', { class: 'linkbox', text: link }),
        el('div', { class: 'dlg-actions' },
          el('button', { type: 'button', class: 'btn', text: 'Luk', onclick: () => dlg.close() }),
          email ? el('a', { class: 'btn', href: `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, text: 'Åbn i mail' }) : null,
          copy));
    },
  });
}

/* ---------- Konto ---------- */
function passwordDialog() {
  const st = { old: '', next: '', again: '' };
  openDialog({
    title: 'Skift adgangskode',
    build(body, dlg) {
      const err = el('p', { class: 'err', role: 'alert' });
      const submit = el('button', { type: 'submit', class: 'btn primary', text: 'Gem adgangskode' });
      const form = el('form', { class: 'dlg-body', style: 'padding:0', novalidate: true },
        el('div', { class: 'field' }, el('label', { for: 'pw-old', text: 'Nuværende adgangskode' }), el('input', { type: 'password', id: 'pw-old', autocomplete: 'current-password', oninput: e => { st.old = e.target.value; } })),
        el('div', { class: 'field' }, el('label', { for: 'pw-new', text: 'Ny adgangskode' }), el('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', oninput: e => { st.next = e.target.value; } }), el('span', { class: 'hint', text: 'Mindst 8 tegn.' })),
        el('div', { class: 'field' }, el('label', { for: 'pw-again', text: 'Gentag ny adgangskode' }), el('input', { type: 'password', id: 'pw-again', autocomplete: 'new-password', oninput: e => { st.again = e.target.value; } })),
        err,
        el('div', { class: 'dlg-actions' }, el('button', { type: 'button', class: 'btn', text: 'Annuller', onclick: () => dlg.close() }), submit));
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (st.next.length < 8) { err.textContent = 'Den nye adgangskode skal være mindst 8 tegn.'; return; }
        if (st.next !== st.again) { err.textContent = 'De to nye adgangskoder er ikke ens.'; return; }
        submit.disabled = true;
        const r = await api('change_password', { old_password: st.old, new_password: st.next });
        submit.disabled = false;
        if (!r.ok) { err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
        dlg.close(); toast('Adgangskode gemt');
      });
      body.append(form);
      setTimeout(() => $('#pw-old') && $('#pw-old').focus(), 0);
    },
  });
}

async function logout() {
  await api('logout');
  store.del('dk_token');
  S.token = null; S.me = null; S.selected = null; S.form = null;
  showLogin();
}

/* ---------- Dialog og toast ---------- */
function openDialog({ title, build }) {
  const dlg = el('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-title' });
  dlg.append(
    el('div', { class: 'dlg-head' }, el('h2', { id: 'dlg-title', text: title }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Luk', text: '×', onclick: () => dlg.close() })));
  const body = el('div', { class: 'dlg-body' });
  dlg.append(body);
  document.body.append(dlg);
  build(body, dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
  return dlg;
}

function toast(msg, bad) {
  if (!msg) return;
  const t = el('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3800);
}

/* ---------- Log ind og invitation ---------- */
function gate(children) {
  $('#app').replaceChildren(el('div', { class: 'gate' },
    el('section', { class: 'gate-hero', 'aria-hidden': 'true' }, heroMark()),
    el('section', { class: 'gate-form' }, children)));
  document.title = 'Driftskalender';
}

function showLogin(message) {
  const err = el('p', { class: 'err', role: 'alert', text: message || '' });
  const email = el('input', { type: 'email', id: 'li-email', autocomplete: 'username', required: true });
  const pw = el('input', { type: 'password', id: 'li-pw', autocomplete: 'current-password', required: true });
  const submit = el('button', { type: 'submit', class: 'btn primary', text: 'Log ind' });
  const form = el('form', { novalidate: true },
    el('div', { class: 'field' }, el('label', { for: 'li-email', text: 'E-mail' }), email),
    el('div', { class: 'field' }, el('label', { for: 'li-pw', text: 'Adgangskode' }), pw),
    err, submit);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!email.value.trim() || !pw.value) { err.textContent = 'Skriv e-mail og adgangskode.'; return; }
    submit.disabled = true; err.textContent = '';
    const r = await api('login', { email: email.value, password: pw.value }, { auth: false });
    submit.disabled = false;
    if (!r.ok) { err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
    await enter(r.token);
  });
  gate([
    el('h1', { text: 'Driftskalender' }),
    el('p', { class: 'lede', text: 'Se hvem der kan bidrage i driften, og hvad der skal nås.' }),
    form,
    el('p', { class: 'fine', text: 'Adgang kræver en invitation fra administratoren.' })]);
  setTimeout(() => (message ? pw : email).focus(), 0);
}

async function enter(token) {
  S.token = token;
  store.set('dk_token', token);
  try { history.replaceState(null, '', location.pathname + '#' + (VIEWS.includes(S.view) ? S.view : 'kalender')); } catch (e) { /* ingen historik */ }
  const r = await loadData();
  if (r && r.ok) renderApp();
  else { S.token = null; store.del('dk_token'); showLogin(r && r.error); }
}

async function startClaim(invite) {
  gate([el('h1', { text: 'Driftskalender' }), el('p', { class: 'lede', text: 'Henter din invitation…' })]);
  const info = await api('invite_info', { invite }, { auth: false });
  if (!info.ok) {
    gate([
      el('h1', { text: 'Driftskalender' }),
      el('p', { class: 'err', role: 'alert', text: info.error || 'Invitationen kunne ikke hentes.' }),
      el('button', { type: 'button', class: 'btn', text: 'Gå til log ind', onclick: () => { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ingen historik */ } showLogin(); } })]);
    return;
  }
  const st = { name: info.bootstrap ? '' : info.name, email: info.email || '', pw: '', again: '' };
  const err = el('p', { class: 'err', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'btn primary', text: 'Opret adgang' });
  const form = el('form', { novalidate: true },
    info.bootstrap ? el('div', { class: 'field' }, el('label', { for: 'cl-name', text: 'Dit navn' }), el('input', { type: 'text', id: 'cl-name', maxlength: 80, autocomplete: 'name', oninput: e => { st.name = e.target.value; } })) : null,
    info.bootstrap ? el('div', { class: 'field' }, el('label', { for: 'cl-email', text: 'E-mail' }), el('input', { type: 'email', id: 'cl-email', autocomplete: 'username', oninput: e => { st.email = e.target.value; } })) : el('p', {}, 'Din e-mail: ', el('b', { text: info.email })),
    el('div', { class: 'field' }, el('label', { for: 'cl-pw', text: 'Vælg adgangskode' }), el('input', { type: 'password', id: 'cl-pw', autocomplete: 'new-password', oninput: e => { st.pw = e.target.value; } }), el('span', { class: 'hint', text: 'Mindst 8 tegn.' })),
    el('div', { class: 'field' }, el('label', { for: 'cl-again', text: 'Gentag adgangskode' }), el('input', { type: 'password', id: 'cl-again', autocomplete: 'new-password', oninput: e => { st.again = e.target.value; } })),
    err, submit);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (info.bootstrap && !st.name.trim()) { err.textContent = 'Skriv dit navn.'; return; }
    if (st.pw.length < 8) { err.textContent = 'Adgangskoden skal være mindst 8 tegn.'; return; }
    if (st.pw !== st.again) { err.textContent = 'De to adgangskoder er ikke ens.'; return; }
    submit.disabled = true; err.textContent = '';
    const r = await api('claim_invite', { invite, name: st.name, email: st.email, password: st.pw }, { auth: false });
    submit.disabled = false;
    if (!r.ok) { err.textContent = r.error || 'Det lykkedes ikke. Prøv igen.'; return; }
    await enter(r.token);
  });
  gate([
    el('h1', { text: info.bootstrap ? 'Opret administrator' : `Velkommen, ${(info.name || '').split(' ')[0]}` }),
    el('p', { class: 'lede', text: info.bootstrap ? 'Du bliver den første administrator og kan derefter invitere de andre.' : info.role === 'drift' ? 'Du får læseadgang og kan se kalender, opgaver og medarbejdere. Vælg en adgangskode for at oprette din adgang.' : 'Vælg en adgangskode for at oprette din adgang.' }),
    form]);
  setTimeout(() => { const n = $('#cl-name') || $('#cl-pw'); if (n) n.focus(); }, 0);
}

/* ---------- Start ---------- */
async function boot() {
  const hash = location.hash.slice(1);
  const inv = /^invite=([A-Za-z0-9]{20,})$/.exec(hash);
  if (inv) return startClaim(inv[1]);
  if (VIEWS.includes(hash)) S.view = hash;
  if (S.token) {
    $('#app').replaceChildren(el('p', { class: 'loading', text: 'Henter…' }));
    const r = await loadData();
    if (r && r.ok) { renderApp(); return; }
    if (!S.token) return; // sessionen er udløbet, og login-skærmen er allerede vist
    if (r && r.network) { $('#app').replaceChildren(el('p', { class: 'loading', text: r.error }), el('p', { class: 'loading' }, el('button', { type: 'button', class: 'btn', text: 'Prøv igen', onclick: () => location.reload() }))); return; }
    store.del('dk_token'); S.token = null;
  }
  showLogin();
}

document.addEventListener('click', e => {
  document.querySelectorAll('details.acct[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheetOpen && !document.querySelector('dialog[open]')) closeSheet();
});
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (S.me && VIEWS.includes(h) && h !== S.view) { S.view = h; renderApp(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) silentRefresh(); });
setInterval(silentRefresh, 60000);

boot();

})();
