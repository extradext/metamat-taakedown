/* app.js — mode-separated day-of app. No external requests; API only.
   My Wrestler: ONLY selected wrestler, card, up-next, result, warm-up prompt.
   Organizer/Table, Spectator, Guest, About live in their own modes. */
const S = { mode: 'wrestler', role: 'parent', session: null, token: null, account: null, wrestlerId: null, tournamentId: null, cache: {} };
try {
  S.tournamentId = localStorage.getItem('fa-tid') || null;
  S.role = localStorage.getItem('fa-role') || 'parent';
  if (!['parent', 'organizer', 'table'].includes(S.role)) S.role = 'parent';
  S.session = localStorage.getItem('fa-session') || null;
  if (!['guest', 'demo', 'authed'].includes(S.session)) S.session = null;
} catch { /* private mode */ }
function saveSession() { try { localStorage.setItem('fa-session', S.session || ''); } catch { /* private mode */ } }
function curTid() { return S.tournamentId || 'demo-tournament'; }
function saveTid(id) { S.tournamentId = id; try { localStorage.setItem('fa-tid', id); } catch { /* private mode */ } paintDemoTag(); }
// The DEMO DATA tag follows the viewed tournament: visible for demo data,
// hidden for real tournaments. Session-cached tournament list; offline keeps
// the last known state rather than guessing.
let demoTagCache = null;
async function paintDemoTag() {
  try {
    if (!demoTagCache) demoTagCache = ((await api('/tournaments')).tournaments || []);
    const t = demoTagCache.find((x) => x.id === curTid());
    document.querySelector('.demo-tag').hidden = !(t ? t.demo : true);
  } catch { /* offline: leave the tag as-is */ }
}
window.FA = S; // explicit bridge so Card Studio follows the selected wrestler
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm ' + s + 's';
  return s + 's';
}
function wirePills(rootId, attr, set) {
  document.querySelectorAll('#' + rootId + ' .chip').forEach((c) => c.onclick = () => {
    set(c.dataset[attr]);
    document.querySelectorAll('#' + rootId + ' .chip').forEach((x) => x.classList.toggle('on', x === c));
  });
}
function infoRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return '<div class="inforow"><span class="k">' + esc(label) + '</span><span>' + esc(value) + '</span></div>';
}
function statCell(label, value) {
  return '<div class="stat"><span class="n">' + value + '</span><span class="l">' + esc(label) + '</span></div>';
}
const ICONS = {
  mat: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="4"/>',
  weight: '<circle cx="12" cy="14" r="6"/><path d="M9.5 8.5V6.8a2.5 2.5 0 0 1 5 0v1.7"/>',
  school: '<path d="M6 3v18"/><path d="M6 4.5h11l-2.5 3.8L17 12H6"/>',
  status: '<path d="M3 12h4l2.5 7 4-14 2.5 7H21"/>',
  rest: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 3"/>',
  result: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12.3l2.4 2.4 4.6-5.4"/>',
  pin: '<path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/><path d="M12 15v6"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.8-3.8 3.8-5.5 7.5-5.5s6.7 1.7 7.5 5.5"/>',
  grid: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M9.5 4v16M3.5 12h6"/>',
  trophy: '<path d="M7 4h10v4.5a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.5a2.5 2.5 0 0 0 2.7 4.5M17 5.5h2.5a2.5 2.5 0 0 1-2.7 4.5M12 13.5V17M8.5 20.5h7"/>',
  note: '<path d="M5 4h14v11.5H9.5L5 20z"/><path d="M9 8.5h6M9 12h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2.5"/>',
  plus: '<circle cx="12" cy="12" r="8"/><path d="M12 8.5v7M8.5 12h7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1.5 1.5M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1.5-1.5"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  ondeck: '<circle cx="12" cy="12" r="8"/><path d="M8 12h7M12.5 8.5L16 12l-3.5 3.5"/>',
  hole: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.6"/>',
  alert: '<path d="M12 3.5L21 20H3z"/><path d="M12 9.5V14M12 16.8v.4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
};
function icon(name) {
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}
function avatar(name) {
  const init = String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return '<span class="avatar" aria-hidden="true">' + esc(init) + '</span>';
}
function schoolChip(team) {
  if (!team || team === 'Unattached') return '<span class="sch sch-none">Unattached</span>';
  let h = 0;
  for (const c of team) h = (h * 31 + c.charCodeAt(0)) % 997;
  return '<span class="sch sch' + (h % 6) + '">' + esc(team) + '</span>';
}
// Vector Arena mark (mat circle + shield). The same mark lives in the header,
// the landing hero, the packet, and the favicon. Wordmark text always sits in
// HTML beside the mark — artwork layers never render lettering.
const LOGO_MARK = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#0b1220" stroke="#d8a93c" stroke-width="3"/><path d="M24 10 L36 14 V24 C36 32 30 37 24 39 C18 37 12 32 12 24 V14 Z" fill="none" stroke="#d8a93c" stroke-width="2.5" stroke-linejoin="round"/><circle cx="24" cy="23" r="5" fill="none" stroke="#f5f7fa" stroke-width="2.5"/></svg>';
// Flat limited-palette illustrations (navy / gold / slate only): landing hero,
// empty brackets / notes / viewable lists, and the completed celebration.
const ILLUS = {
  hero: '<svg viewBox="0 0 200 120" aria-hidden="true"><ellipse cx="100" cy="96" rx="88" ry="16" fill="#141d33" stroke="#d8a93c" stroke-width="3"/><ellipse cx="100" cy="90" rx="52" ry="10" fill="none" stroke="#8fa0b8" stroke-width="2.5"/><circle cx="100" cy="52" r="30" fill="#0b1220" stroke="#d8a93c" stroke-width="3"/><path d="M100 30 L118 36 V52 C118 63 109 70 100 73 C91 70 82 63 82 52 V36 Z" fill="none" stroke="#f5f7fa" stroke-width="2.5" stroke-linejoin="round"/><g fill="#d8a93c"><circle cx="52" cy="40" r="4"/><circle cx="148" cy="40" r="4"/><circle cx="70" cy="24" r="2.5"/><circle cx="130" cy="24" r="2.5"/></g></svg>',
  brackets: '<svg viewBox="0 0 200 120" aria-hidden="true"><g fill="#141d33" stroke="#8fa0b8" stroke-width="2.5"><rect x="14" y="14" width="64" height="20" rx="6"/><rect x="14" y="44" width="64" height="20" rx="6"/><rect x="14" y="74" width="64" height="20" rx="6"/><rect x="122" y="44" width="64" height="20" rx="6"/></g><g stroke="#d8a93c" stroke-width="2.5" fill="none"><path d="M78 24h16v30h28M78 54h16M78 84h16V54h28"/></g><circle cx="100" cy="104" r="5" fill="none" stroke="#f5f7fa" stroke-width="2.5"/></svg>',
  notes: '<svg viewBox="0 0 200 120" aria-hidden="true"><rect x="60" y="10" width="80" height="100" rx="8" fill="#141d33" stroke="#d8a93c" stroke-width="3"/><g stroke="#8fa0b8" stroke-width="2.5"><path d="M74 34h52M74 50h52M74 66h34"/></g><circle cx="150" cy="88" r="14" fill="#0b1220" stroke="#f5f7fa" stroke-width="2.5"/><path d="M144 88h12M150 82v12" stroke="#d8a93c" stroke-width="2.5"/></svg>',
  scanned: '<svg viewBox="0 0 200 120" aria-hidden="true"><rect x="62" y="12" width="76" height="76" rx="8" fill="#f5f7fa"/><g fill="#0b1220"><rect x="70" y="20" width="20" height="20"/><rect x="110" y="20" width="20" height="20"/><rect x="70" y="60" width="20" height="20"/><rect x="100" y="50" width="10" height="10"/><rect x="114" y="64" width="12" height="12"/></g><circle cx="150" cy="88" r="14" fill="#0b1220" stroke="#d8a93c" stroke-width="2.5"/><path d="M144 88h12M150 82v12" stroke="#f5f7fa" stroke-width="2.5"/></svg>',
  celebrate: '<svg viewBox="0 0 200 120" aria-hidden="true"><path d="M100 12 L132 24 V56 C132 80 116 94 100 100 C84 94 68 80 68 56 V24 Z" fill="#141d33" stroke="#d8a93c" stroke-width="3" stroke-linejoin="round"/><path d="M100 34l7 14 15 2-11 11 3 15-14-7-14 7 3-15-11-11 15-2z" fill="#d8a93c"/><g fill="#8fa0b8"><circle cx="44" cy="40" r="4"/><circle cx="156" cy="40" r="4"/><circle cx="56" cy="84" r="3"/><circle cx="144" cy="84" r="3"/></g></svg>',
};
function emptyWrap(illus, title, body) {
  return '<div class="emptywrap">' + (ILLUS[illus] || '') + '<div class="etitle">' + esc(title) + '</div><p>' + esc(body) + '</p></div>';
}
// Shimmer skeleton painted on every view switch so navigation feels instant.
const VIEW_LABELS = { landing: 'Welcome', wrestler: 'My Wrestler', spectator: 'Brackets', tournament: 'Tournament', notes: 'Notes', organizer: 'Organizer', table: 'Table', guest: 'Bracket Generator', studio: 'Card Studio' };
function viewSkeleton(mode) {
  return '<div class="loading" aria-live="polite"><div class="skel"></div><div class="skel short"></div><p>Loading ' + esc(VIEW_LABELS[mode] || 'view') + '…</p></div>';
}
// Display settings: persisted, applied as body classes, and honored by the
// studio tilt. Saved choices win; otherwise the OS preferences are the default.
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('fa-settings') || '{}'); } catch { /* private mode */ }
  S.settings = {
    reduceMotion: saved.reduceMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
    highContrast: saved.highContrast ?? matchMedia('(prefers-contrast: more)').matches,
  };
}
function applySettings() {
  if (!S.settings) loadSettings();
  document.body.classList.toggle('rm', !!S.settings.reduceMotion);
  document.body.classList.toggle('hc', !!S.settings.highContrast);
  const r = document.getElementById('set-rm');
  if (r) r.checked = !!S.settings.reduceMotion;
  const h = document.getElementById('set-hc');
  if (h) h.checked = !!S.settings.highContrast;
}
function saveSettings() {
  try { localStorage.setItem('fa-settings', JSON.stringify(S.settings)); } catch { /* private mode */ }
}
const BULL_SECTIONS = ['Alerts', 'Parking', 'Snacks/Concessions', 'Raffles', 'General Info'];
// Mirrors the server normalize: legacy strings plus {text, author, at, pinned,
// expires} objects. Expired entries never display; pinned sort first, stably.
function normBull(entries) {
  const now = new Date().toISOString();
  const live = [];
  for (const e of entries || []) {
    if (typeof e === 'string') live.push({ text: e, author: null, at: null, pinned: false });
    else if (e && typeof e.text === 'string') {
      if (e.expires && String(e.expires) <= now) continue;
      const norm = { text: e.text, author: e.author || null, at: e.at || null, pinned: !!e.pinned };
      if (e.expires) norm.expires = e.expires;
      live.push(norm);
    }
  }
  return [...live.filter((e) => e.pinned), ...live.filter((e) => !e.pinned)];
}
// Client mirror of the server clears-after line: derived from the posting +
// expiry the organizer set, so app, tabs, and packet all read the same.
function clearsAfter(e) {
  if (!e || !e.expires) return '';
  if (e.at) {
    const hrs = Math.round((new Date(e.expires).getTime() - new Date(e.at).getTime()) / 3600000);
    if (Number.isFinite(hrs) && hrs > 0) return 'Clears after ' + hrs + 'h';
  }
  try { return 'Clears ' + new Date(e.expires).toLocaleString(); }
  catch { return 'Clears soon'; }
}
function parseBulletin(entries) {
  const out = { Alerts: [], Parking: [], 'Snacks/Concessions': [], Raffles: [], 'General Info': [] };
  for (const e of normBull(entries)) {
    const m = e.text.match(/^\[(Alerts?|Parking|Snacks?|Concessions?|Raffles?|Info|General)\]\s*([\s\S]*)$/i);
    let sec = 'General Info';
    let text = e.text;
    if (m) {
      text = m[2];
      const k = m[1].toLowerCase();
      sec = k.startsWith('alert') ? 'Alerts' : k.startsWith('park') ? 'Parking'
        : (k.startsWith('snack') || k.startsWith('conces')) ? 'Snacks/Concessions'
        : k.startsWith('raffl') ? 'Raffles' : 'General Info';
    } else {
      const low = text.toLowerCase();
      if (/alert|urgent|clos|emergency|delay/.test(low)) sec = 'Alerts';
      else if (/park/.test(low)) sec = 'Parking';
      else if (/snack|concession|food/.test(low)) sec = 'Snacks/Concessions';
      else if (/raffle/.test(low)) sec = 'Raffles';
    }
    out[sec].push({ ...e, text });
  }
  return out;
}
function bullMeta(e) {
  const bits = [];
  if (e.pinned) bits.push('Pinned');
  if (e.author) bits.push(e.author);
  if (e.at) { try { bits.push(new Date(e.at).toLocaleString()); } catch { /* bad date: skip */ } }
  const clears = clearsAfter(e);
  if (clears) bits.push(clears);
  return bits.length ? ' <span class="bullmeta">· ' + esc(bits.join(' · ')) + '</span>' : '';
}
// Client mirror of the server scan-code renderer (same deterministic grid)
// plus the one-bracket public-view short link. The hash only ever expands a
// public bracket — it can never carry a guardian invite.
function bracketShortLink(id) { return '#b=' + encodeURIComponent(id); }
function qrSvg(payload, size) {
  size = size || 84;
  const s = String(payload);
  const n = 21;
  const inFinder = (x, y) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  const finderOn = (x, y) => {
    const lx = x < 8 ? x : x >= n - 8 ? x - (n - 7) : -1;
    const ly = y < 8 ? y : y >= n - 8 ? y - (n - 7) : -1;
    if (lx < 0 || ly < 0 || lx > 6 || ly > 6) return false;
    if (lx === 0 || lx === 6 || ly === 0 || ly === 6) return true;
    return lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
  };
  const bit = (x, y) => {
    let h = 2166136261;
    const mix = (v) => { h ^= v & 0xffffffff; h = Math.imul(h, 16777619); };
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
    mix(x * 31 + 7); mix(y * 57 + 13);
    return (h >>> 0) % 2 === 0;
  };
  let cells = '<rect x="0" y="0" width="' + n + '" height="' + n + '" fill="#fff"/>';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (inFinder(x, y) ? finderOn(x, y) : bit(x, y)) {
      cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#111"/>';
    }
  }
  return '<svg class="qr" viewBox="0 0 ' + n + ' ' + n + '" width="' + size + '" height="' + size + '" role="img" aria-label="Scan code">' + cells + '</svg>';
}
// Scanned brackets accumulate here (localStorage): every bracket sheet the
// device opens joins the Viewable Brackets list in Bracket Generator.
function scannedBrackets() {
  try { return JSON.parse(localStorage.getItem('fa-scanned') || '[]'); }
  catch { return []; }
}
function rememberScanned(id, division) {
  if (!id) return;
  try {
    const list = scannedBrackets().filter((x) => x && x.id !== id);
    list.unshift({ id, division: division || id, at: new Date().toISOString() });
    localStorage.setItem('fa-scanned', JSON.stringify(list.slice(0, 20)));
  } catch { /* no storage */ }
}
function bulletinHTML(entries) {
  const g = parseBulletin(entries);
  const shown = BULL_SECTIONS.filter((s) => g[s].length);
  if (!shown.length) return '<p>No announcements yet — the organizer posts schedule changes and raffle news here.</p>';
  return shown.map((s) => '<h3>' + s + '</h3>' + g[s].map((t) => '<p>' + esc(t.text) + bullMeta(t) + '</p>').join('')).join('');
}
// Display mats are simple numbers: a split surface 1A/1B shows as Mat 1/Mat 2.
// Rule: digit d + letter L -> (d-1)*2 + (A=1, B=2...). Plain digits pass through.
function mapMat(raw) {
  if (raw == null || raw === '') return null;
  const m = String(raw).match(/^(\d+)([A-Za-z])?$/);
  if (!m) return String(raw);
  if (!m[2]) return Number(m[1]);
  return (Number(m[1]) - 1) * 2 + (m[2].toUpperCase().charCodeAt(0) - 64);
}
function matLabel(raw) { const n = mapMat(raw); return n == null ? 'Mat TBD' : 'Mat ' + n; }
// The server sends 'TBD' as its undecided-slot sentinel; the app always shows
// the explained words, never the bare code.
function tbdName(n) { return n === 'TBD' ? 'To be decided' : n; }
// Tournament-wide mat clock in match numbers (never clock times): the live
// bout if one is wrestling, else the next upcoming bout number on that mat.
function matNow(allMatches, mat) {
  const q = (allMatches || []).filter((m) => m.mat === mat && m.status !== 'completed' && m.bout != null)
    .sort((x, y) => x.bout - y.bout);
  if (!q.length) return null;
  const live = q.find((m) => m.live || m.status === 'in-progress');
  return { now: (live || q[0]).bout, live: !!live };
}
// Next-match truth (client mirror of server nextBoutFor): the wrestler's
// actual next is the earliest incomplete bout involving them. Completed
// bouts are never next. Match detail uses this so a stale snapshot can
// never paint a past bout as "Your next".
function nextFor(board, wid) {
  if (!board || !wid) return null;
  let best = null;
  for (const b of board.brackets || []) for (const m of b.matches || []) {
    if (m.status === 'completed' || m.bout == null) continue;
    if (m.aid !== wid && m.bid !== wid) continue;
    if (!best || m.bout < best.bout) best = m;
  }
  return best;
}
function boutEst(board, nextMatch) {
  if (!nextMatch || nextMatch.mat == null || nextMatch.bout == null) return null;
  const all = (board.brackets || []).flatMap((b) => b.matches || []);
  const now = matNow(all, nextMatch.mat);
  if (!now) return null;
  return { mat: mapMat(nextMatch.mat), now: now.now, yours: nextMatch.bout, away: nextMatch.bout - now.now };
}
function estStrip(e, whose) {
  if (!e) return '';
  const away = e.away <= 0 ? 'on now' : '<b>' + e.away + ' bouts away</b>';
  return '<div class="eststrip">' + icon('mat') + ' Mat ' + esc(e.mat) + ' · Now: Match ' + esc(e.now)
    + ' · ' + esc(whose || 'Your next') + ': Match ' + esc(e.yours) + ' · ' + away + '</div>';
}
// '2026-11-07' -> 'Sat Nov 7, 2026' (parsed as local parts, never UTC-shifted).
function fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || 'Date TBA';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return wd + ' ' + mo + ' ' + d.getDate() + ', ' + d.getFullYear();
}
// Queue position on the match's own mat: first pending = On deck, second = In the hole.
function queueTag(board, m) {
  if (!board || m.mat == null || m.bout == null) return null;
  const q = (board.brackets || []).flatMap((b) => b.matches || [])
    .filter((x) => x.mat === m.mat && x.status !== 'completed' && !(x.live || x.status === 'in-progress') && x.bout != null)
    .sort((x, y) => x.bout - y.bout);
  if (q[0] && q[0].id === m.id) return 'ondeck';
  if (q[1] && q[1].id === m.id) return 'hole';
  return null;
}
// One status system everywhere: same pills, same icons, same wording.
// Every pill pairs its icon with a text label — never colour alone.
function statusPill(m, board) {
  if (!m) return '';
  if (m.status === 'completed') return '<span class="pill p-done">' + icon('result') + ' Final</span>';
  if (m.live || m.status === 'in-progress') return '<span class="pill p-live">' + icon('status') + ' Live</span>';
  const tag = board ? queueTag(board, m) : null;
  if (tag === 'ondeck') return '<span class="pill p-mid">' + icon('ondeck') + ' On deck</span>';
  if (tag === 'hole') return '<span class="pill p-todo">' + icon('hole') + ' In the hole</span>';
  return '<span class="pill p-todo">' + icon('clock') + ' Upcoming</span>';
}
function heldPill(detail) {
  return '<span class="pill p-held">' + icon('rest') + ' Held' + (detail ? ' — ' + esc(detail) : '') + '</span>';
}
// Deterministic multi-kid proximity: bouts apart + same/different mat, never clock times.
function proxHTML(mine, c) {
  const up = (c && c.upcoming) || {};
  const ids = mine.map((w) => w.id).filter((id) => up[id] && up[id].bout_number != null);
  if (ids.length < 2) return '';
  const nm = (id) => (mine.find((w) => w.id === id) || {}).name || 'Wrestler';
  let html = '';
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const x = up[ids[i]], y = up[ids[j]];
    const apart = Math.abs(x.bout_number - y.bout_number);
    const same = x.mat != null && x.mat === y.mat;
    const alert = (c.alerts || []).find((a) => a.pair && a.pair.includes(ids[i]) && a.pair.includes(ids[j]));
    const cls = alert && alert.level === 'red' ? 'held' : '';
    html += '<p class="' + cls + '">' + icon('status') + ' ' + esc(nm(ids[i])) + ' (Mat ' + esc(mapMat(x.mat)) + ', Match ' + esc(x.bout_number) + ')'
      + ' ↔ ' + esc(nm(ids[j])) + ' (Mat ' + esc(mapMat(y.mat)) + ', Match ' + esc(y.bout_number) + '): '
      + '<b>' + apart + ' bouts apart</b>, ' + (same ? 'same mat' : 'different mats')
      + (alert ? ' — ' + esc(alert.message) : '') + '</p>';
  }
  return html;
}
const PRESET_OPTIONS = [
  ['youth-local', 'Youth Local'], ['usaw-2025-26', 'USAW 2025-26'], ['nfhs-2024-25', 'NFHS 2024-25'],
  ['ncaa-2024-25', 'NCAA 2024-25'], ['aau-2026', 'AAU 2026'],
];
const TYPE_OPTIONS = ['Open', 'Championship', 'Duals', 'Novice'];
const FORMAT_OPTIONS = [['double-elim', 'Double elimination'], ['round-robin', 'Round robin'], ['single-elim', 'Single elimination'], ['pool-to-bracket', 'Pool to bracket']];
const FORMAT_LABELS = Object.fromEntries(FORMAT_OPTIONS);
const REST_OPTIONS = [15, 20, 30, 45, 60];

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.headers && res.headers.get && res.headers.get('X-Arena-Stale')) stampSync(true);
  if (!res.ok) throw new Error(data.error || ('request failed: ' + path));
  S.cache[path] = { at: Date.now(), data };
  stampSync(false);
  return data;
}
function stampSync(stale) {
  const el = document.getElementById('syncstate');
  if (el) el.textContent = stale ? 'Offline — showing cached (stale) data' : ('Last updated: ' + new Date().toLocaleTimeString());
}
window.addEventListener('offline', () => stampSync(true));

const ENCOURAGE = [
  'Have you helped someone today?',
  'Great job today — not just the score, the effort.',
  'Win or learn. You showed up, you wrestled, you grew.',
  'Effort is the part you control.',
  'Be the teammate you would want beside you, on and off the mat.',
];
const WARMUPS = [
  'Be sure you are getting warmed up before your match — it is good to get your blood flowing.',
  'Sip some water and check your gear: headgear, shoelaces, singlet.',
  'Slow breaths in through the nose, out through the mouth. You are ready.',
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const FINISHES = ['classic', 'shiny', 'shiny-glittery', 'fire', 'ice', 'lightning', 'attack', 'brick-wall', 'super-silly', 'friendly', 'fierce', 'a-little-scary'];
function cardTheme(card) {
  const th = card && card.template && card.template.theme;
  return FINISHES.indexOf(th) >= 0 ? th : 'classic';
}
function matchupHTML(m, board) {
  if (!m) return '';
  const done = m.status === 'completed';
  const winA = !!(done && m.wid && m.aid && m.wid === m.aid);
  const winB = !!(done && m.wid && m.bid && m.wid === m.bid);
  const sub = done
    ? icon('result') + ' ' + esc(m.outcome || '') + ' · ' + esc(m.scoreA ?? '–') + '–' + esc(m.scoreB ?? '–')
    : m.live ? icon('status') + ' Live · Match ' + esc(m.bout ?? '?') + ' · ' + matLabel(m.mat)
    : icon('mat') + ' Match ' + esc(m.bout ?? '?') + ' · ' + matLabel(m.mat);
  return '<div class="matchup">'
    + '<div class="side' + (winA ? ' winnerglow' : '') + '">' + cardFace({ template: { name: tbdName(m.a) } }, true) + '</div>'
    + '<div class="side' + (winB ? ' winnerglow' : '') + '">' + cardFace({ template: { name: tbdName(m.b) } }, true) + '</div>'
    + '</div><div class="boutmeta">' + statusPill(m, board) + ' ' + sub + '</div>';
}
const SIL_ART = '<svg class="silart" viewBox="0 0 500 360" aria-hidden="true">'
  + '<defs><linearGradient id="appsilg" x1="0" y1="0" x2="1" y2="1">'
  + '<stop offset="0" stop-color="#2c3a58"/><stop offset="1" stop-color="#10151c"/>'
  + '</linearGradient><linearGradient id="appsilbeam" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="rgba(255,244,214,.28)"/><stop offset="1" stop-color="rgba(255,244,214,0)"/>'
  + '</linearGradient></defs><rect width="500" height="360" fill="url(#appsilg)"/>'
  + '<polygon points="150,0 205,0 120,360 55,360" fill="url(#appsilbeam)"/>'
  + '<polygon points="330,0 375,0 430,360 375,360" fill="url(#appsilbeam)"/>'
  + '<ellipse cx="250" cy="330" rx="175" ry="22" fill="rgba(0,0,0,.4)"/>'
  + '<ellipse cx="250" cy="330" rx="120" ry="14" fill="none" stroke="rgba(216,169,60,.5)" stroke-width="4"/>'
  + '<g stroke="#05070b" stroke-linecap="round" fill="none">'
  + '<path d="M228 252 L186 332" stroke-width="36"/><path d="M272 252 L336 322" stroke-width="36"/>'
  + '<path d="M202 168 L146 232 L118 292" stroke-width="30"/><path d="M298 168 L344 118 L372 76" stroke-width="30"/></g>'
  + '<path d="M196 152 Q250 118 304 152 L288 252 Q250 268 212 252 Z" fill="#05070b"/>'
  + '<path d="M196 152 Q250 118 304 152 L300 168 Q250 138 200 168 Z" fill="rgba(216,169,60,.35)"/>'
  + '<circle cx="250" cy="92" r="32" fill="#05070b"/>'
  + '<path d="M222 82 a32 32 0 0 1 56 0" stroke="rgba(216,169,60,.7)" stroke-width="7" fill="none" stroke-linecap="round"/>'
  + '<path d="M250 64 L250 44 M228 70 L218 52 M272 70 L282 52" stroke="rgba(216,169,60,.7)" stroke-width="5" stroke-linecap="round"/></svg>';
function cardSource(card) {
  if (!card || !card.art) return 'SAMPLE ART';
  if (card.edition === 'photo' || card.photoSource) return 'PHOTO';
  if (card.artIsMock) return 'SAMPLE ART';
  return 'GENERATED';
}
function cardFace(card, mini = false) {
  if (!card) return '<div class="' + (mini ? 'minicard' : 'cardface') + ' fin-classic"><div class="inset"><div class="nameplate"><span>No card yet</span></div><div class="artwin"></div></div><div class="finish" aria-hidden="true"></div></div>';
  const t = card.template || {};
  const src = cardSource(card);
  const rcls = src === 'GENERATED' ? 'genribbon' : src === 'PHOTO' ? 'photoribbon' : 'artribbon';
  const ribbon = (card.art || !mini) ? '<div class="' + rcls + '">' + src + '</div>' : '';
  const noart = !mini && !card.art ? SIL_ART : '';
  return '<div class="' + (mini ? 'minicard' : 'cardface') + ' fin-' + cardTheme(card) + (t.layout === 'full' ? ' fullpic' : '') + '">'
    + '<div class="inset"><div class="nameplate"><span>' + esc(t.name) + '</span><span class="ed">' + esc(card.edition || '') + '</span></div>'
    + '<div class="artwin">' + ribbon + noart + (card.art ? '<img alt="Card art" src="' + card.art + '">' : '') + '</div>'
    + '<div class="moves">' + (t.moves || []).map((m) => esc(m)).join('<br>') + '</div>'
    + '<div class="flavor">' + esc(t.flavorLine || '') + '</div></div><div class="finish" aria-hidden="true"></div></div>';
}

/* ---------------- My Wrestler (landing — NOTHING else on this page) ---------------- */
async function myWrestler() {
  const v = document.getElementById('view');
  let mine = [];
  try { mine = (await api('/me/wrestlers')).wrestlers || []; } catch { /* offline: use cache */ }
  if (!S.wrestlerId && mine[0]) S.wrestlerId = mine[0].id;
  if (!S.wrestlerId) {
    v.innerHTML = '<div class="panel"><h2>My Wrestler</h2><p>Sign in as a guardian to link a wrestler, or pick a demo wrestler below.</p><div id="demoopts"></div></div>';
    try {
      const d = await api('/demo/wrestlers');
      document.getElementById('demoopts').innerHTML = d.wrestlers.map((w) =>
        '<button class="big" data-w="' + w.id + '">' + avatar(w.name) + ' ' + esc(w.name) + ' · ' + esc(w.short_id) + '</button>').join('');
      document.querySelectorAll('#demoopts button').forEach((b) => b.onclick = () => { S.wrestlerId = b.dataset.w; myWrestler(); });
    } catch { v.innerHTML += '<p>Offline and nothing cached yet.</p>'; }
    return;
  }
  let snap;
  try { snap = await api('/wrestler/' + S.wrestlerId + '/snapshot' + (S.tournamentId ? '?tournamentId=' + S.tournamentId : '')); }
  catch { v.innerHTML = '<div class="panel"><p>Could not load. Check connection.</p></div>'; return; }
  let board = null;
  try { board = await api('/public/' + (S.tournamentId || 'demo-tournament') + '/spectate'); } catch { /* offline */ }
  const findMatch = (bracketId, matchId) => {
    if (!board || !matchId) return null;
    for (const b of board.brackets || []) {
      if (bracketId && b.id !== bracketId) continue;
      const hit = (b.matches || []).find((m) => m.id === matchId);
      if (hit) return hit;
    }
    return null;
  };
  // First-paint truth: the board is fresher than the snapshot. If the
  // snapshot's next already went Final, drop it — a past bout is never next.
  if (board && snap.next) {
    const chk = findMatch(snap.next.bracket_id, snap.next.match_id);
    if (chk && chk.status === 'completed') snap.next = null;
  }
  const nx = snap.next || {};
  const sq2 = nx.current ? '<div class="square now"><span class="k">NEXT MATCH</span><span class="v">NOW · ' + esc(nx.bout_number ?? '') + '</span></div>'
    : nx.bout_number != null ? '<div class="square"><span class="k">NEXT MATCH</span><span class="v">' + esc(nx.bout_number) + '</span></div>'
      : '<div class="square"><span class="k">NEXT MATCH</span><span class="v">Done</span></div>';
  const lastDone = (kidId) => {
    if (!board) return null;
    let best = null;
    for (const b of board.brackets || []) for (const m of b.matches || []) {
      if (m.status !== 'completed' || (m.aid !== kidId && m.bid !== kidId)) continue;
      if (!best || (m.bout ?? -1) > (best.bout ?? -1)) best = m;
    }
    return best;
  };
  const kids = mine.length ? mine : [{ id: S.wrestlerId, name: snap.wrestler.name }];
  // Hero = the selected wrestler's next bout (or last, when nothing is left).
  let heroM = snap.next ? findMatch(snap.next.bracket_id, snap.next.match_id) : null;
  let heroTag = heroM ? (snap.next.current ? 'NOW' : 'UP NEXT') : null;
  if (!heroM) { heroM = lastDone(S.wrestlerId); heroTag = heroM ? 'LAST MATCH' : null; }
  const heroEst = heroM && heroTag !== 'LAST MATCH' ? boutEst(board, heroM) : null;
  const heroOpp = heroM ? (heroM.aid === S.wrestlerId ? heroM.b : heroM.a) : null;
  const hero = heroM ? '<div class="panel hero"><div class="herotop">' + statusPill(heroM, board)
    + '<span class="herotag">' + esc(heroTag) + '</span></div>'
    + '<h2 class="heroname">' + esc(snap.wrestler.name) + '</h2>'
    + (heroTag !== 'LAST MATCH' && heroOpp ? '<div class="heroopp">vs ' + esc(tbdName(heroOpp)) + ' · Match ' + esc(heroM.bout ?? '?') + ' · ' + matLabel(heroM.mat) + '</div>' : '')
    + (heroEst ? estStrip(heroEst) : '')
    + matchupHTML(heroM, board) + '</div>' : '';
  let bouts = '';
  for (const kid of kids) {
    if (kid.id === S.wrestlerId) continue; // hero panel above covers the selected wrestler
    let s = null;
    try { s = await api('/wrestler/' + kid.id + '/snapshot' + (S.tournamentId ? '?tournamentId=' + S.tournamentId : '')); } catch { continue; }
    let m = s.next ? findMatch(s.next.bracket_id, s.next.match_id) : null;
    if (m && m.status === 'completed') m = null; // stale snapshot: a past bout is never next
    let tag = m ? (s.next.current ? 'NOW' : 'UP NEXT') : null;
    if (!m) { m = lastDone(kid.id); tag = m ? 'LAST MATCH' : null; }
    if (!m) continue;
    // Sibling panel: labeled for THAT wrestler, showing THEIR next bout with
    // their own mat countdown — never the selected wrestler's.
    const sibEst = tag !== 'LAST MATCH' ? boutEst(board, m) : null;
    bouts += '<div class="panel"><h3>Also watching — ' + esc(kid.name) + '</h3>'
      + (tag ? '<div class="herotag">' + esc(tag) + '</div>' : '')
      + (sibEst ? estStrip(sibEst, kid.name + "'s next") : '')
      + matchupHTML(m, board) + '</div>';
  }
  const r = snap.rest || {};
  const restLine = r.state === 'held'
    ? '<p class="held">' + icon('rest') + ' Rest held — ' + esc(r.message || '') + '</p>'
    : '<p class="clear">' + icon('result') + ' ' + esc(r.message || 'Clear to wrestle.') + '</p>';
  const restRule = r.floorMin != null
    ? '<p class="hint">Rest rule: ' + esc(r.floorMin) + ' min between matches'
      + (r.lastEnd ? ' · last match ended ' + esc(new Date(r.lastEnd).toLocaleTimeString()) : ' · no matches yet today')
      + (heroEst && heroEst.away > 0 ? ' · ' + heroEst.away + ' bouts away' : '') + '.</p>' : '';
  const switcher = mine.length > 1 ? '<div class="panel"><h3>My Wrestlers</h3><div class="chipline" id="kidswitch">'
    + mine.map((w) => '<button class="chip' + (w.id === S.wrestlerId ? ' on' : '') + '" data-w="' + w.id + '">' + esc(w.name) + '</button>').join('')
    + '</div><div id="prox"></div><div class="row"><button class="big" id="famlink">Family sharing</button></div></div>' : '';
  v.innerHTML = '<section aria-label="My Wrestler">'
    + hero + switcher
    + '<div class="panel"><div class="row"><div><h2 style="margin:0">' + avatar(snap.wrestler.name) + ' ' + esc(snap.wrestler.name) + '</h2>'
    + '<div style="color:var(--muted)">Grade ' + esc(snap.wrestler.grade) + '</div>'
    + '<div style="margin-top:6px">' + schoolChip(snap.wrestler.team) + '</div></div>'
    + '<div class="squares"><div class="square"><span class="k">' + icon('mat') + ' MAT</span>' + (nx.mat == null ? '<span class="v" title="Mat not assigned yet — check the board at the venue">TBD</span>' : '<span class="v">' + esc(mapMat(nx.mat)) + '</span>') + '</div>' + sq2 + '</div></div>'
    + restLine + restRule
    + '</div>'
    + '<div class="cardframe">' + cardFace(snap.card) + '</div>'
    + bouts
    + '<div class="split">'
    + ((snap.notes && snap.notes.some((n) => n.author_role !== 'coach')) ? '<div class="panel"><h3>Notes</h3><p>' + snap.notes.filter((n) => n.author_role !== 'coach').map((n) => esc(n.body)).join('</p><p>') + '</p></div>' : '')
    + ((snap.coachFeedback && snap.coachFeedback.length) ? '<div class="panel"><h3>From the coach</h3><p>' + snap.coachFeedback.map(esc).join('</p><p>') + '</p></div>' : '')
    + '</div>'
    + '<details class="menu"><summary>More</summary><div class="menubody">'
    + '<div class="panel"><h3>Today</h3><p>' + esc(snap.today || 'No matches yet today.') + '</p></div>'
    + '<div class="panel"><h3>Warm-up</h3><p>' + esc(pick(WARMUPS)) + '</p>'
    + '<button class="big" id="notew">Add a note for later</button></div>'
    + '</div></details>'
    + '<p class="encourage">' + esc(pick(ENCOURAGE)) + '</p>'
    + '</section>';
  if (mine.length > 1 && S.token) {
    try {
      const c = await api('/tournaments/' + (S.tournamentId || 'demo-tournament') + '/conflicts?wrestlerIds=' + mine.map((w) => w.id).join(','));
      const el = document.getElementById('prox');
      if (el) el.innerHTML = proxHTML(mine, c);
    } catch { /* conflicts unavailable offline */ }
  }
  const fam = document.getElementById('famlink');
  if (fam) fam.onclick = () => setMode('notes');
  const nb = document.getElementById('notew');
  if (nb) nb.onclick = async () => {
    const body = prompt('Note (private to your household and coaches):');
    if (!body) return;
    try { await api('/notes', { method: 'POST', body: { wrestlerId: S.wrestlerId, tournamentId: S.tournamentId, body, scope: 'private' } }); alert('Saved.'); }
    catch (e) { alert(e.message); }
  };
  v.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => { S.wrestlerId = b.dataset.w; myWrestler(); });
}

/* ---------------- Spectator / Brackets (permission-controlled projection) ---------------- */
async function spectator() {
  const v = document.getElementById('view');
  const tid = S.tournamentId || 'demo-tournament';
  let data;
  try { data = await api('/public/' + tid + '/spectate'); }
  catch { v.innerHTML = '<div class="panel"><p>Spectator view unavailable offline.</p></div>'; return; }
  // No Team block: it was an arbitrary first-12 registration slice, not a real
  // feature. Next-bout detail lives in My Wrestlers, the bracket sheets, and
  // the mat queues below — every datum it showed is still one glance away.
  const blist = data.brackets || [];
  S.expanded = S.expanded || [];
  let pins = [];
  try { pins = (JSON.parse(localStorage.getItem('fa-pins') || '{}')[curTid()] || []); } catch { pins = []; }
  if (S.token) {
    try {
      const sp = await api('/me/pins');
      if (sp.pins && sp.pins[curTid()]) pins = sp.pins[curTid()];
    } catch { /* offline: session pins only */ }
  }
  pins = pins.filter((id) => blist.some((b) => b.id === id)).slice(0, 2);
  const parseDiv = (div) => {
    const m = String(div || '').match(/^(\S+)\s+(\d+\s*-\s*\d+)/);
    if (m) return { age: m[1], band: m[2].replace(/\s+/g, '') };
    return { age: String(div || '').split(/\s+/)[0] || 'Open', band: '' };
  };
  // Same decided-match predicate as the server day totals (status completed
  // AND a result present — the spectate projection carries it as `outcome`).
  const decided = (m) => m.status === 'completed' && m.outcome != null;
  const rowStatus = (b) => {
    const ms = b.matches || [];
    const done = ms.filter(decided).length;
    const live = ms.filter((m) => m.live || m.status === 'in-progress').length;
    if (ms.length && done === ms.length) return { t: 'Complete', c: 'done', i: 'result' };
    if (live) return { t: 'Live ' + live, c: 'live', i: 'status' };
    if (done) return { t: done + ' of ' + ms.length + ' decided', c: 'mid', i: 'ondeck' };
    return { t: 'Upcoming', c: 'todo', i: 'clock' };
  };
  const wcount = (b) => new Set((b.matches || []).flatMap((m) => [m.aid, m.bid]).filter(Boolean)).size;
  const isComplete = blist.length > 0 && blist.every((b) => (b.matches || []).length > 0 && (b.matches || []).every(decided));
  const bracketRow = (b, isPinned) => {
    const st = rowStatus(b);
    // Division + weight band once, in the title — never repeated in the sub.
    return '<div class="brow2" data-brow="' + b.id + '">'
      + '<button class="browmain" data-expand="' + b.id + '" aria-expanded="false"><span class="browtitle">' + icon('weight') + ' ' + esc(b.division) + '</span>'
      + '<span class="browsub">' + wcount(b) + ' wrestlers · <span class="pill p-' + st.c + '">' + icon(st.i) + ' ' + esc(st.t) + '</span></span></button>'
      + '<button class="linkbtn" data-link="' + b.id + '" aria-label="Bracket link for ' + esc(b.division) + '">' + icon('link') + ' <span>Link</span></button>'
      + '<button class="pinbtn' + (isPinned ? ' on' : '') + '" data-pin="' + b.id + '" aria-label="' + (isPinned ? 'Unpin ' : 'Pin ') + esc(b.division) + '">' + icon('pin') + ' <span class="pinlabel">' + (isPinned ? 'Pinned' : 'Pin') + '</span></button></div>'
      + '<div class="blinkpan" data-linkpan="' + b.id + '" hidden></div>'
      + '<div class="bracket-sheet" data-mount="' + b.id + '" hidden></div>';
  };
  const linkPanHTML = (b) => '<div class="sheetlink">' + qrSvg('arena:bracket:' + b.id, 96)
    + '<div><b>Bracket link: ' + esc(bracketShortLink(b.id)) + '</b><br>'
    + 'Add it to the end of the Arena address to open this bracket\u2019s public view. '
    + 'Never a family invite.</div></div>';
  const pinned = pins.map((id) => blist.find((b) => b.id === id)).filter(Boolean);
  let rest = blist.filter((b) => !pins.includes(b.id));
  // Club-filtered view (from a club search result): brackets holding club
  // members, plus each member's next match. Cleared, never sticky.
  let clubBanner = '';
  if (S.clubFilter && S.clubFilter.members) {
    const ids = new Set(S.clubFilter.members.map((m) => m.id));
    const holds = (b) => (b.matches || []).some((m) => ids.has(m.aid) || ids.has(m.bid));
    rest = rest.filter(holds);
    const rows = S.clubFilter.members.map((m) => {
      const nx = nextFor(data, m.id);
      return '<div class="qrow"><span class="qwho">' + esc(m.name) + '</span>'
        + (nx ? '<span class="qbout">Match ' + esc(nx.bout ?? '?') + ' · ' + matLabel(nx.mat) + '</span>' + statusPill(nx, data)
          : '<span class="qstate">Done — no more matches.</span>') + '</div>';
    }).join('');
    clubBanner = '<div class="panel clubfilter"><div class="row"><h3 style="margin:0">Club: ' + esc(S.clubFilter.club) + '</h3>'
      + '<button class="big" id="clubclear" style="margin-left:auto">Clear filter</button></div>' + rows + '</div>';
  }
  const groups = {};
  for (const b of rest) {
    const age = parseDiv(b.division).age;
    (groups[age] = groups[age] || []).push(b);
  }
  let brackets = '<div class="panel"><div class="row"><h2 style="margin:0">Brackets</h2>'
    + '<button class="big" id="brkrefresh" style="margin-left:auto">Refresh</button>'
    + '<button class="big" id="brkpacket">Print packet</button></div><div id="brkdetail"></div>'
    + (isComplete ? emptyWrap('celebrate', 'Tournament complete', 'Every bracket is Final — results below are read-only.') : '')
    + '<div id="brklist">'
    + (pinned.length ? '<h3 class="pinhead">Pinned</h3>' + pinned.map((b) => bracketRow(b, true)).join('') : '')
    + Object.entries(groups).map(([age, arr]) => '<h3>' + esc(age) + '</h3>' + arr.map((b) => bracketRow(b, false)).join('')).join('')
    + (blist.length ? '' : emptyWrap('brackets', 'No brackets published yet', 'Check-in is still open — brackets appear here once the organizer seeds and shares them.')) + '</div></div>';
  const paintOne = (id) => {
    const mount = v.querySelector('[data-mount="' + id + '"]');
    const b = blist.find((x) => x.id === id);
    if (!mount || !b || !window.Bracket) return;
    mount.hidden = false;
    window.Bracket.renderSheet(mount, {
      title: (data.tournament ? data.tournament + ' — ' : '') + b.division,
      sub: (data.date ? fmtDate(data.date) + ' · ' : '') + 'Tap Refresh for live results.',
      format: b.format, matches: b.matches,
    });
    const link = document.createElement('div');
    link.innerHTML = linkPanHTML(b);
    mount.appendChild(link);
    // Wires draw in on expand (CSS animation, instant under reduced motion).
    mount.classList.add('draw');
    setTimeout(() => mount.classList.remove('draw'), 320);
    const btn = v.querySelector('[data-expand="' + id + '"]');
    if (btn) { btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    if (!S.expanded.includes(id)) S.expanded.push(id);
    rememberScanned(id, b.division);
    try { history.replaceState(null, '', bracketShortLink(id)); } catch { /* no history */ }
  };
  const foldOne = (id) => {
    const mount = v.querySelector('[data-mount="' + id + '"]');
    if (mount) { mount.hidden = true; mount.innerHTML = ''; }
    const btn = v.querySelector('[data-expand="' + id + '"]');
    if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    S.expanded = S.expanded.filter((x) => x !== id);
  };
  let galMode = 'per';
  const galHtml = () => '<div class="row"><button class="big" id="gper">This tournament</button><button class="big" id="gall">All time</button></div><div class="kudosgallery">'
    + (data.kudos || []).map((k) => '<div class="kudoscard">' + cardFace(k.card, true)
      + '<div>' + esc(k.name) + ' · ' + (galMode === 'per' ? k.count : k.allTime) + ' kudos (' + (galMode === 'per' ? 'tournament' : 'all-time') + ')</div>'
      + '<button class="kudosbtn" data-k="' + k.id + '">Give Kudos</button></div>').join('') + '</div>';
  let gal = '<div class="panel"><h2>Sportsmanship Stars</h2><div id="galbody">' + galHtml() + '</div></div>';
  v.innerHTML = clubBanner + brackets + '<div class="panel"><h2>' + icon('status') + ' Bulletin</h2>' + bulletinHTML(data.bulletin) + '</div>' + gal;
  const clubclear = document.getElementById('clubclear');
  if (clubclear) clubclear.onclick = () => { S.clubFilter = null; spectator(); };
  v.querySelectorAll('[data-expand]').forEach((btn) => btn.onclick = () => {
    const id = btn.dataset.expand;
    const mount = v.querySelector('[data-mount="' + id + '"]');
    if (mount && mount.hidden) paintOne(id);
    else foldOne(id);
  });
  v.querySelectorAll('[data-link]').forEach((btn) => btn.onclick = (e) => {
    e.stopPropagation();
    const id = btn.dataset.link;
    const pan = v.querySelector('[data-linkpan="' + id + '"]');
    const b = blist.find((x) => x.id === id);
    if (!pan || !b) return;
    if (pan.hidden) { pan.innerHTML = linkPanHTML(b); pan.hidden = false; }
    else { pan.hidden = true; pan.innerHTML = ''; }
  });
  v.querySelectorAll('[data-pin]').forEach((btn) => btn.onclick = async (e) => {
    e.stopPropagation();
    const id = btn.dataset.pin;
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
    if (next.length > 2) { alert('Unpin one first — two pinned brackets max.'); return; }
    try {
      const all = JSON.parse(localStorage.getItem('fa-pins') || '{}');
      all[curTid()] = next;
      localStorage.setItem('fa-pins', JSON.stringify(all));
    } catch { /* no storage */ }
    if (S.token) {
      try { await api('/me/pins', { method: 'POST', body: { pins: { [curTid()]: next } } }); } catch { /* offline */ }
    }
    spectator();
  });
  const brkrefresh = document.getElementById('brkrefresh');
  if (brkrefresh) brkrefresh.onclick = () => spectator();
  const brkpacket = document.getElementById('brkpacket');
  if (brkpacket) brkpacket.onclick = () => { window.open('/api/packet/' + tid, '_blank'); };
  if (window.Bracket) window.Bracket.setTapHandler((t) => openMatchDetail(data, t.mid));
  for (const id of [...S.expanded]) paintOne(id);
  // Bracket short links (#b=<id>) open that bracket's public view directly.
  if (!S.afterSpectator) {
    const hm = String(location.hash || '').match(/^#b=(.+)$/);
    if (hm) {
      const id = decodeURIComponent(hm[1]);
      if (blist.some((b) => b.id === id) && !S.expanded.includes(id)) {
        S.afterSpectator = { expand: id, match: null };
      }
    }
  }
  if (S.afterSpectator) {
    const nav = S.afterSpectator;
    S.afterSpectator = null;
    paintOne(nav.expand);
    requestAnimationFrame(() => {
      const mount = v.querySelector('[data-mount="' + nav.expand + '"]');
      if (mount) mount.scrollIntoView({ block: 'start' });
      if (nav.match) {
        const el = v.querySelector('[data-mid="' + nav.match + '"]');
        if (el) {
          el.scrollIntoView({ block: 'center' });
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 2200);
        }
      }
    });
  }
  const wireKudos = () => v.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
    try { await api('/kudos', { method: 'POST', body: { tournamentId: tid, wrestlerId: b.dataset.k } }); alert('Kudos given — kind words, no votes, no counts on cards.'); spectator(); }
    catch (e) { alert(e.message); }
  });
  const wireToggle = () => {
    const p = document.getElementById('gper'); const a = document.getElementById('gall');
    if (p) p.onclick = () => { galMode = 'per'; document.getElementById('galbody').innerHTML = galHtml(); wireKudos(); wireToggle(); };
    if (a) a.onclick = () => { galMode = 'all'; document.getElementById('galbody').innerHTML = galHtml(); wireKudos(); wireToggle(); };
  };
  wireKudos(); wireToggle();
}

/* ---------------- Organizer / Table (explicit mode, role-checked) ---------------- */
async function organizer() {
  const v = document.getElementById('view');
  if (!S.account) {
    v.innerHTML = '<div class="panel"><h2>Sign in</h2><p>Organizer functions need a role-checked organizer account.</p><div id="accts"></div></div>';
    const a = await api('/demo/accounts');
    document.getElementById('accts').innerHTML = a.accounts.filter((x) => x.role === 'organizer').map((x) =>
      '<button class="big" data-a="' + x.id + '">' + esc(x.name) + ' · ' + esc(x.role) + '</button>').join('');
    document.querySelectorAll('#accts button').forEach((b) => b.onclick = async () => {
      const r = await api('/auth/login', { method: 'POST', body: { accountId: b.dataset.a } });
      S.token = r.token; S.account = r.account; organizer();
    });
    return;
  }
  let list = [];
  try { list = (await api('/tournaments')).tournaments || []; } catch { list = []; }
  const mine = list.filter((t) => t.mine);
  if (!S.tournamentId || !list.some((t) => t.id === S.tournamentId)) {
    const pick = mine.length === 1 ? mine[0].id : (list[0] && list[0].id);
    if (pick) saveTid(pick);
  }
  const ordered = [...mine, ...list.filter((t) => !t.mine)];
  const isOrg = S.account.role === 'organizer';
  v.innerHTML = '<div class="panel"><h2>Organizer / Table</h2><p>Signed in as ' + esc(S.account.name) + ' (' + esc(S.account.role) + ')</p>'
    + '<label>Tournaments — each is its own separate space</label><div class="chipline" id="orgpicks">' + ordered.map((t) =>
      '<button class="chip' + (t.id === S.tournamentId ? ' on' : '') + '" data-t="' + t.id + '">' + esc(t.name) + (isOrg && !t.mine ? ' · shared' : '') + '</button>').join('')
    + '</div><div class="row"><button class="big primary" id="tnew">New tournament</button>'
    + '<button class="big" id="ttable">Table scoreboard</button>'
    + '<button class="big" id="tpacket">Printable packet</button>'
    + '<button class="big" id="tsettings">Tournament settings</button></div></div><div id="orgbody"></div>';
  v.querySelectorAll('#orgpicks [data-t]').forEach((b) => b.onclick = () => { saveTid(b.dataset.t); organizer(); });
  document.getElementById('tnew').onclick = () => setupCreate();
  document.getElementById('ttable').onclick = () => tableMode();
  document.getElementById('tpacket').onclick = () => { window.open('/api/packet/' + curTid(), '_blank'); };
  document.getElementById('tsettings').onclick = () => setupEditor(curTid(), 'orgbody', () => organizer());
}

// Sign-in log: name/ID, mat (table), sign-in/out times, shift, handoff. The
// same panel renders in the Table Worker view and the Organizer Table view.
async function renderTableLog(mountId, tid, table, name) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  let log = [];
  try { log = (await api('/table/' + tid + '/log')).log || []; }
  catch { mount.innerHTML = '<div class="panel"><p>Sign-in log unavailable offline.</p></div>'; return; }
  const fmtT = (iso) => { if (!iso) return 'not yet'; try { return new Date(iso).toLocaleTimeString(); } catch { return iso; } };
  const rows = log.map((t) => '<h3>Table ' + esc(t.table) + '</h3>' + (t.workers.length ? t.workers.map((w) =>
    '<div class="qrow"><span class="qwho">' + esc(w.name) + ' (' + esc(w.role) + ')</span>'
    + '<span class="qstate">in ' + esc(fmtT(w.in)) + (w.out ? ' · out ' + esc(fmtT(w.out)) : ' · ' + esc(w.shift))
    + (w.handoff ? ' · handoff to ' + esc(w.handoff) : '') + '</span></div>').join('') : '<p>No crew clocked in.</p>')).join('')
    || '<p>No tables have clocked in yet.</p>';
  mount.innerHTML = '<div class="panel"><h2>Sign-in log</h2>' + rows
    + (name ? '<div class="row"><button class="big" id="tlogsignout">Sign out ' + esc(name) + '</button></div><div id="tlogmsg"></div>' : '') + '</div>';
  const so = document.getElementById('tlogsignout');
  if (so) so.onclick = async () => {
    try {
      const r = await api('/table/clockout', { method: 'POST', body: { tournamentId: tid, table: table || '1', name } });
      document.getElementById('tlogmsg').innerHTML = '<p class="clear">Signed out.' + (r.promoted ? ' Handoff to ' + esc(r.promoted.name) + '.' : '') + '</p>';
      renderTableLog(mountId, tid, table, null);
    } catch (e) { document.getElementById('tlogmsg').innerHTML = '<p class="held">' + esc(e.message) + '</p>'; }
  };
}

async function tableMode(resumeName, table, freshClockin) {
  const body = document.getElementById('orgbody');
  const tid = S.tournamentId || 'demo-tournament';
  let tables = ['1'];
  try { tables = (await api('/table/' + tid + '/tables')).tables || ['1']; } catch { /* offline: table 1 only */ }
  const tbl = tables.includes(table) ? table : tables[0];
  const name = resumeName || prompt('Clock in — your name or identifier:', S.account.name) || S.account.name;
  if (!resumeName || freshClockin) {
    try { await api('/table/clockin', { method: 'POST', body: { tournamentId: tid, table: tbl, name } }); }
    catch (e) { body.innerHTML = '<div class="panel"><p>' + esc(e.message) + '</p></div>'; return; }
  }
  const picker = tables.length > 1 ? '<div class="chipline" id="tablepick">' + tables.map((t) =>
    '<button class="chip' + (t === tbl ? ' on' : '') + '" data-table="' + esc(t) + '">Table ' + esc(t) + '</button>').join('') + '</div>' : '';
  const wirePicker = () => body.querySelectorAll('[data-table]').forEach((c) => c.onclick = async () => {
    if (c.dataset.table === tbl) return;
    try { await api('/table/clockout', { method: 'POST', body: { tournamentId: tid, table: tbl, name } }); }
    catch { /* not clocked there: just move */ }
    tableMode(name, c.dataset.table, true);
  });
  // The landing view's log would otherwise stay stale: refresh it the moment
  // this sign-in exists (no-op in Organizer view, where it is absent).
  if (document.getElementById('tlog')) renderTableLog('tlog', tid, tbl, null);
  let q;
  try { q = await api('/table/' + tid + '/queue?table=' + encodeURIComponent(tbl)); } catch (e) { body.innerHTML = '<div class="panel"><p>' + esc(e.message) + '</p></div>'; return; }
  if (!q.queue.length) {
    body.innerHTML = '<div class="panel">' + picker + '<p>No matches assigned to table ' + esc(tbl) + '.</p></div><div id="tboardlog"></div>';
    wirePicker();
    renderTableLog('tboardlog', tid, tbl, name);
    return;
  }
  const m = q.queue[0];
  body.innerHTML = '<div class="panel">' + picker + '<h3>Table ' + esc(tbl) + ' · Match ' + esc(m.bout_number ?? '?') + '</h3>'
    + '<p>' + esc(tbdName(m.a)) + ' (RED) vs ' + esc(tbdName(m.b)) + ' (GREEN)</p>'
    + (m.hold ? '<p class="held">' + esc(m.hold) + '</p>' : '')
    + '<table class="scores"><tr><th>RED</th><th>GREEN</th></tr><tr>'
    + '<td><button class="scorebtn red" data-s="red" data-p="1">+1</button> <button class="scorebtn red" data-s="red" data-p="2">+2</button> <button class="scorebtn red" data-s="red" data-p="3">+3</button></td>'
    + '<td><button class="scorebtn green" data-s="green" data-p="1">+1</button> <button class="scorebtn green" data-s="green" data-p="2">+2</button> <button class="scorebtn green" data-s="green" data-p="3">+3</button></td>'
    + '</tr></table><p>Score: <span id="live">0 – 0</span></p>'
    + '<div class="row"><button class="big" id="undo">Undo last point</button><button class="big primary" id="final">Finalize</button></div></div>'
    + '<div id="finalpanel"></div>'
    + '<div class="panel"><h3>Clocks</h3><div class="row"><div><label>Match (sec)</label><input id="ckc" type="number" min="0"></div>'
    + '<div><label>Blood (sec)</label><input id="ckb" type="number" min="0"></div>'
    + '<div><label>Injury (sec)</label><input id="cki" type="number" min="0"></div></div>'
    + '<div class="row"><button class="big" id="ckgo">Save clocks</button></div><p id="ckmsg" class="hint">Blood and injury time never add to the match clock.</p></div>'
    + '<div id="tboardlog"></div>';
  wirePicker();
  renderTableLog('tboardlog', tid, tbl, name);
  body.querySelectorAll('.scorebtn').forEach((b) => b.onclick = async () => {
    const side = b.dataset.s, pts = Number(b.dataset.p);
    const live = await api('/table/score', { method: 'POST', body: { tournamentId: tid, bracketId: m.bracket_id, matchId: m.match_id, play: { side, points: pts, label: side + ' +' + pts } } });
    document.getElementById('live').textContent = live.red + ' – ' + live.green;
    document.getElementById('undo').textContent = 'Undo last point: take back ' + side + ' +' + pts;
  });
  document.getElementById('undo').onclick = async () => {
    const r = await api('/table/undo', { method: 'POST', body: { tournamentId: tid, bracketId: m.bracket_id, matchId: m.match_id } });
    document.getElementById('live').textContent = r.live.red + ' – ' + r.live.green;
    document.getElementById('undo').textContent = 'Took back ' + r.undone.side + ' +' + r.undone.points + ' — Undo last point';
  };
  document.getElementById('ckgo').onclick = async () => {
    const num = (id) => { const raw = document.getElementById(id).value.trim(); if (raw === '') return null; const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : null; };
    try {
      await api('/table/score', {
        method: 'POST',
        body: { tournamentId: tid, bracketId: m.bracket_id, matchId: m.match_id, clockSec: num('ckc'), bloodSec: num('ckb'), injurySec: num('cki') },
      });
      document.getElementById('ckmsg').textContent = 'Clocks saved — they count toward tournament stats at finalize.';
    } catch (e) { document.getElementById('ckmsg').textContent = e.message; }
  };
  // Finalize entirely in-view: pick winner + outcome, confirm, see the result
  // and advance — or see exactly why it cannot finalize. No blocking
  // browser dialogs in this flow: when they are suppressed the tap was a
  // literal no-op with no feedback and the board never advanced.
  const OUTCOMES = [['decision', 'Decision'], ['pin', 'Pin'], ['tech-fall', 'Tech fall'], ['major', 'Major']];
  const outcomeLabel = (o) => (OUTCOMES.find(([id]) => id === o) || OUTCOMES[0])[1];
  let finWinner = 'RED', finOutcome = 'decision';
  const fpanel = () => document.getElementById('finalpanel');
  const lockBoard = (on) => {
    document.getElementById('final').disabled = on;
    body.querySelectorAll('.scorebtn').forEach((b) => { b.disabled = on; });
  };
  document.getElementById('final').onclick = () => {
    fpanel().innerHTML = '<div class="panel"><h3>Finalize Match ' + esc(m.bout_number ?? '?') + '?</h3>'
      + '<p>' + esc(tbdName(m.a)) + ' (RED) vs ' + esc(tbdName(m.b)) + ' (GREEN)</p>'
      + '<label>Winner</label><div class="row"><button class="big" data-win="RED">RED · ' + esc(tbdName(m.a)) + '</button>'
      + '<button class="big" data-win="GREEN">GREEN · ' + esc(tbdName(m.b)) + '</button></div>'
      + '<label>Outcome</label><div class="chipline" id="finout">' + OUTCOMES.map(([id, label]) =>
        '<button class="chip' + (id === finOutcome ? ' on' : '') + '" data-out="' + id + '">' + label + '</button>').join('') + '</div>'
      + '<div class="row"><button class="big primary" id="fingo">Confirm final</button><button class="big" id="fincancel">Cancel</button></div></div>';
    const paintWin = () => fpanel().querySelectorAll('[data-win]').forEach((b) => b.classList.toggle('primary', b.dataset.win === finWinner));
    paintWin();
    fpanel().querySelectorAll('[data-win]').forEach((b) => b.onclick = () => { finWinner = b.dataset.win; paintWin(); });
    fpanel().querySelectorAll('[data-out]').forEach((b) => b.onclick = () => {
      finOutcome = b.dataset.out;
      fpanel().querySelectorAll('[data-out]').forEach((x) => x.classList.toggle('on', x === b));
    });
    document.getElementById('fincancel').onclick = () => { fpanel().innerHTML = ''; };
    document.getElementById('fingo').onclick = async () => {
      lockBoard(true);
      try {
        const r = await api('/table/finalize', { method: 'POST', body: { tournamentId: tid, bracketId: m.bracket_id, matchId: m.match_id, winner: finWinner, outcome: finOutcome } });
        const s = r.summary || {};
        const line = (s.winnerSide || finWinner) + ' · ' + esc(s.winnerName || '') + ' — '
          + outcomeLabel(s.outcome || finOutcome) + ' ' + (s.red ?? '?') + '–' + (s.green ?? '?');
        let nextHtml = '';
        try {
          const nq = await api('/table/' + tid + '/queue?table=' + encodeURIComponent(tbl));
          const nx = (nq.queue || [])[0];
          nextHtml = nx ? '<p>Next: Match ' + esc(nx.bout_number ?? '?') + ' — ' + esc(tbdName(nx.a)) + ' vs ' + esc(tbdName(nx.b)) + '</p>'
            + '<div class="row"><button class="big primary" id="finnext">Next match</button></div>'
            : '<p>Done — no more matches.</p><div class="row"><button class="big" id="finnext">Back to table</button></div>';
        } catch { nextHtml = '<div class="row"><button class="big" id="finnext">Next match</button></div>'; }
        fpanel().innerHTML = '<div class="panel"><h3>Match finalized.</h3><p>' + line + '</p>' + nextHtml + '</div>';
        document.getElementById('finnext').onclick = () => tableMode(name, tbl);
      } catch (e) {
        lockBoard(false);
        fpanel().innerHTML = '<div class="panel"><h3>Could not finalize</h3><p>' + esc(e.message) + '</p>'
          + '<div class="row"><button class="big" id="finretry">Try again</button></div></div>';
        document.getElementById('finretry').onclick = () => { fpanel().innerHTML = ''; };
      }
    };
  };
}

/* ---------------- Tournament setup: guided flow (create) + editor (edit later) ---------------- */
function setupFormHTML(o) {
  const info = o.info || {};
  const val = (k) => esc(info[k] ?? '');
  const pills = (id, attr, options, current, labels) => '<div class="chipline" id="' + id + '">'
    + options.map((x) => '<button class="chip' + (String(x) === String(current) ? ' on' : '') + '" data-' + attr + '="' + esc(x) + '">'
      + esc(labels ? labels[x] : x) + '</button>').join('') + '</div>';
  return '<label>Tournament name</label><input id="su-name" type="text" value="' + esc(o.name ?? '') + '">'
    + '<label>Tournament type</label>' + pills('su-type', 'type', TYPE_OPTIONS, info.type || 'Open')
    + (o.isEdit
      ? '<label>Rules</label><p>' + esc(o.presetId) + ' (' + esc(o.presetStatus) + ') — the rules edition locks at creation; rest time below can still change with a reason.</p>'
      : '<label>Rules</label><select id="su-preset">' + PRESET_OPTIONS.map(([id, label]) =>
        '<option value="' + id + '">' + esc(label) + ' (DRAFT)</option>').join('') + '</select>'
        + '<p class="hint">All rule sets ship as DRAFT — verify against the official book.</p>')
    + '<label>Rest between matches</label>' + pills('su-rest', 'rest', REST_OPTIONS, o.rest ?? 20, Object.fromEntries(REST_OPTIONS.map((r) => [r, r + ' min'])))
    + '<label>Bracket format</label>' + pills('su-format', 'format', FORMAT_OPTIONS.map(([id]) => id), info.defaultFormat || 'double-elim', FORMAT_LABELS)
    + '<div class="split"><div><label>Date</label><input id="su-date" type="date" value="' + val('date') + '"></div>'
    + '<div><label>Start time</label><input id="su-start" type="text" placeholder="9:00 AM" value="' + val('startTime') + '"></div></div>'
    + '<label>Doors open</label><input id="su-doors" type="text" placeholder="7:30 AM" value="' + val('doorsTime') + '">'
    + '<label>Venue</label><input id="su-venue" type="text" value="' + esc(o.venue ?? '') + '">'
    + '<div class="split"><div><label>Entry fee</label><input id="su-fee" type="text" placeholder="$35" value="' + val('fee') + '"></div>'
    + '<div><label>Tables</label><input id="su-tables" type="number" min="1" value="' + val('tables') + '"></div></div>'
    + '<label>Registration info</label><textarea id="su-reg" rows="2">' + val('regDetails') + '</textarea>'
    + '<div class="split"><div><label>Referees</label><input id="su-refs" type="number" min="0" value="' + val('referees') + '"></div>'
    + '<div><label>Head referee</label><input id="su-headref" type="text" value="' + val('headRef') + '"></div></div>'
    + '<label>Check-in times</label><input id="su-weighins" type="text" placeholder="Fri 6–8 PM, Sat 7–8 AM" value="' + val('weighins') + '">'
    + '<label>Raffle</label><textarea id="su-raffle" rows="2">' + val('raffle') + '</textarea>'
    + '<label>Contact</label><input id="su-contact" type="text" value="' + val('contact') + '">'
    + '<label>Other notes</label><textarea id="su-notes" rows="2">' + val('notes') + '</textarea>';
}
function collectSetup() {
  const val = (id) => document.getElementById(id).value.trim();
  return {
    name: val('su-name'), venue: val('su-venue'),
    info: {
      type: document.querySelector('#su-type .chip.on')?.dataset.type || 'Open',
      defaultFormat: document.querySelector('#su-format .chip.on')?.dataset.format || 'double-elim',
      date: val('su-date'), startTime: val('su-start'), doorsTime: val('su-doors'),
      fee: val('su-fee'), regDetails: val('su-reg'), tables: val('su-tables'),
      referees: val('su-refs'), headRef: val('su-headref'), weighins: val('su-weighins'),
      raffle: val('su-raffle'), contact: val('su-contact'), notes: val('su-notes'),
    },
    rest: Number(document.querySelector('#su-rest .chip.on')?.dataset.rest || 20),
  };
}
function setupCreate() {
  const body = document.getElementById('orgbody');
  body.innerHTML = '<div class="panel"><h3>New tournament — guided setup</h3>' + setupFormHTML({}) + '<div id="su-msg"></div>'
    + '<div class="row"><button class="big primary" id="su-go">Create tournament</button></div></div>';
  wirePills('su-type', 'type', () => {});
  wirePills('su-rest', 'rest', () => {});
  wirePills('su-format', 'format', () => {});
  document.getElementById('su-go').onclick = async () => {
    const msg = document.getElementById('su-msg');
    const f = collectSetup();
    try {
      const t = await api('/tournaments', {
        method: 'POST',
        body: {
          name: f.name || 'Untitled', venue: f.venue,
          presetId: document.getElementById('su-preset').value,
          overrides: { restFloorMin: f.rest }, info: f.info,
        },
      });
      saveTid(t.tournament.id);
      msg.innerHTML = '<p class="clear">Created — you are now in its space. Everything here stays editable under Tournament settings.</p>';
    } catch (e) { msg.innerHTML = '<p class="held">' + esc(e.message) + '</p>'; }
  };
}
async function setupEditor(t, mountId, back) {
  const mount = document.getElementById(mountId);
  let setup;
  try { setup = await api('/tournaments/' + t + '/setup'); }
  catch (e) { mount.innerHTML = '<div class="panel"><p class="held">' + esc(e.message) + '</p></div>'; return; }
  mount.innerHTML = '<div class="panel"><h3>Tournament settings</h3>'
    + setupFormHTML({ info: setup.info, name: setup.name, venue: setup.venue, rest: setup.values.restFloorMin, isEdit: true, presetId: setup.presetId, presetStatus: setup.presetStatus })
    + '<label>Reason (only needed if rest time changed)</label><input id="su-reason" type="text" placeholder="Why the change?">'
    + '<div id="su-msg"></div><div class="row"><button class="big primary" id="su-save">Save changes</button><button class="big" id="su-back">Done</button></div>'
    + '<label>Post an announcement</label><input id="su-bull" type="text" placeholder="Schedule change, raffle winner…">'
    + '<div class="row"><label class="check"><input id="su-pin" type="checkbox"> Pin to top</label></div>'
    + '<label>Clears after (hours, blank = stays up)</label><input id="su-exp" type="number" min="1" placeholder="">'
    + '<div class="row"><button class="big" id="su-post">Post</button></div></div>';
  wirePills('su-type', 'type', () => {});
  wirePills('su-rest', 'rest', () => {});
  wirePills('su-format', 'format', () => {});
  document.getElementById('su-back').onclick = back;
  document.getElementById('su-save').onclick = async () => {
    const msg = document.getElementById('su-msg');
    const f = collectSetup();
    try {
      await api('/tournaments/' + t + '/info', { method: 'POST', body: { name: f.name || setup.name, venue: f.venue, ...f.info } });
      if (f.rest !== setup.values.restFloorMin) {
        const reason = document.getElementById('su-reason').value.trim();
        if (!reason) throw new Error('Rest time changed — a reason is required.');
        await api('/config/correct', { method: 'POST', body: { tournamentId: t, overrides: { restFloorMin: f.rest }, reason } });
      }
      msg.innerHTML = '<p class="clear">Saved.</p>';
    } catch (e) { msg.innerHTML = '<p class="held">' + esc(e.message) + '</p>'; }
  };
  document.getElementById('su-post').onclick = async () => {
    const msg = document.getElementById('su-msg');
    const text = document.getElementById('su-bull').value.trim();
    if (!text) return;
    const hrs = Number(document.getElementById('su-exp').value);
    const body = { text, pinned: document.getElementById('su-pin').checked };
    if (Number.isFinite(hrs) && hrs > 0) body.expires = new Date(Date.now() + hrs * 3600000).toISOString();
    try {
      await api('/tournaments/' + t + '/bulletin', { method: 'POST', body });
      msg.innerHTML = '<p class="clear">Posted — it shows in Brackets, Tournament, and the packet.</p>';
    } catch (e) { msg.innerHTML = '<p class="held">' + esc(e.message) + '</p>'; }
  };
}

function matQueuesHTML(brackets, floorMin) {
  const lastEnd = {};
  const all = [];
  for (const b of brackets || []) for (const m of b.matches || []) {
    all.push(m);
    if (m.status === 'completed' && m.ended) {
      for (const id of [m.aid, m.bid]) {
        if (id && (!lastEnd[id] || m.ended > lastEnd[id])) lastEnd[id] = m.ended;
      }
    }
  }
  const now = Date.now();
  const heldInfo = (m) => {
    const pairs = [[m.aid, m.a], [m.bid, m.b]];
    for (const [id, nm] of pairs) {
      const le = id && lastEnd[id];
      if (!le) continue;
      const rested = (now - new Date(le).getTime()) / 60000;
      if (rested < floorMin) return { name: nm, rested: Math.max(0, Math.floor(rested)) };
    }
    return null;
  };
  const byMat = {};
  for (const m of all) {
    if (m.status === 'completed' || m.mat == null) continue;
    (byMat[m.mat] = byMat[m.mat] || []).push(m);
  }
  const mats = Object.keys(byMat).sort();
  if (!mats.length) return '';
  return '<div class="panel"><h2>' + icon('mat') + ' Mat queues</h2>' + mats.map((mat) => {
    const q = byMat[mat].sort((x, y) => (x.bout ?? 1e9) - (y.bout ?? 1e9));
    const now = matNow(all, mat);
    const pend = q.filter((m) => !(m.live || m.status === 'in-progress'));
    const rows = q.slice(0, 7).map((m) => {
      const held = heldInfo(m);
      const state = (m.live || m.status === 'in-progress')
        ? '<span class="qstate live">' + icon('status') + ' Live</span>'
        : held ? '<span class="qstate heldq">' + icon('rest') + ' Held — ' + esc(held.name) + ' rested ' + held.rested + ' of ' + floorMin + ' min</span>'
        : m === pend[0] ? '<span class="qstate ondeck">' + icon('ondeck') + ' On deck</span>'
        : m === pend[1] ? '<span class="qstate">' + icon('hole') + ' In the hole</span>'
        : '<span class="qstate">' + icon('clock') + ' Upcoming</span>';
      return '<div class="qrow"><span class="qbout">Match ' + esc(m.bout ?? '?') + '</span><span class="qwho">' + esc(tbdName(m.a)) + ' v ' + esc(tbdName(m.b)) + '</span>' + state + '</div>';
    }).join('');
    return '<h3>' + icon('mat') + ' Mat ' + esc(mapMat(mat)) + (now ? ' · Now: Match ' + esc(now.now) : '') + '</h3>' + rows;
  }).join('') + '</div>';
}

function openMatchDetail(board, mid) {
  const mount = document.getElementById('brkdetail');
  if (!mount) return;
  if (!mid || !board) { mount.innerHTML = ''; return; }
  let found = null;
  for (const b of board.brackets || []) {
    const m = (b.matches || []).find((x) => x.id === mid);
    if (m) { found = { b, m }; break; }
  }
  if (!found) { mount.innerHTML = ''; return; }
  const { b, m } = found;
  const all = board.brackets.flatMap((x) => x.matches || []);
  const now = m.mat != null ? matNow(all, m.mat) : null;
  const kidIn = S.wrestlerId && (m.aid === S.wrestlerId || m.bid === S.wrestlerId);
  // Next-match truth: a completed bout is Final only — never "Your next".
  // When the selected wrestler is in this bout, the strip shows THEIR actual
  // next bout (the same match the hero shows), or Done when none is left.
  let strip = '';
  if (kidIn) {
    const actual = nextFor(board, S.wrestlerId);
    if (actual && actual.mat != null && actual.bout != null) {
      const aNow = matNow(all, actual.mat);
      strip = aNow ? estStrip({ mat: mapMat(actual.mat), now: aNow.now, yours: actual.bout, away: actual.bout - aNow.now })
        : '<div class="eststrip">' + icon('mat') + ' Your next: Match ' + esc(actual.bout) + ' · ' + matLabel(actual.mat) + '</div>';
    } else {
      strip = '<div class="eststrip">' + icon('result') + ' Done — no more matches.</div>';
    }
  }
  if (!strip && now) strip = '<div class="eststrip">' + icon('mat') + ' Mat ' + esc(mapMat(m.mat)) + ' · Now: Match ' + esc(now.now) + '</div>';
  mount.innerHTML = '<div class="panel matchdetail"><div class="row"><h3 style="margin:0">' + icon('status') + ' Match detail · ' + esc(b.division) + '</h3>'
    + '<button class="big" id="mdclose" style="margin-left:auto">Close</button></div>'
    + matchupHTML(m, board)
    + strip
    + '</div>';
  document.getElementById('mdclose').onclick = () => { mount.innerHTML = ''; };
  mount.scrollIntoView({ block: 'nearest' });
}

/* ---------------- Tournament hub: info, announcements, stats ---------------- */
async function tournament() {
  const v = document.getElementById('view');
  let list = [];
  try { list = (await api('/tournaments')).tournaments || []; }
  catch { v.innerHTML = '<div class="panel"><p>Tournament list unavailable offline.</p></div>'; return; }
  if (!list.some((t) => t.id === S.tournamentId)) saveTid(list[0] && list[0].id);
  const t = curTid();
  let info = null, stats = null, board = null;
  try { info = await api('/tournaments/' + t + '/info'); } catch { /* offline */ }
  try { stats = await api('/tournaments/' + t + '/stats'); } catch { /* offline */ }
  try { board = await api('/public/' + t + '/spectate'); } catch { /* offline */ }
  if (!info) { v.innerHTML = '<div class="panel"><p>Could not load this tournament.</p></div>'; return; }
  const me = list.find((x) => x.id === t);
  const canEdit = !!(S.account && S.account.role === 'organizer' && me && me.mine);
  const d = info.info || {};
  let html = '<div class="panel"><h2>Tournament</h2><div class="chipline" id="hubpicks">' + list.map((x) =>
    '<button class="chip' + (x.id === t ? ' on' : '') + '" data-t="' + x.id + '">' + esc(x.name)
    + (S.account && S.account.role === 'organizer' && x.mine ? ' · yours' : '') + '</button>').join('') + '</div></div>'
    + '<div class="panel"><h2>' + esc(info.name) + '</h2>'
    + infoRow('Status', info.status) + infoRow('Type', d.type) + infoRow('Venue', info.venue)
    + infoRow('Date', fmtDate(d.date)) + infoRow('Starts', d.startTime) + infoRow('Doors', d.doorsTime)
    + infoRow('Rules', info.rules.presetId + ' (' + info.rules.presetStatus + ')')
    + infoRow('Rest between matches', info.rules.restFloorMin + ' min')
    + infoRow('Bracket format', FORMAT_LABELS[d.defaultFormat] || d.defaultFormat)
    + infoRow('Entry fee', d.fee) + infoRow('Registration', d.regDetails)
    + infoRow('Tables', d.tables) + infoRow('Referees', d.referees) + infoRow('Head referee', d.headRef)
    + infoRow('Check-in times', d.weighins) + infoRow('Contact', d.contact) + infoRow('Notes', d.notes) + '</div>'
    + (d.raffle ? '<div class="banner"><b>Raffle:</b> ' + esc(d.raffle) + '</div>' : '')
    + '<div class="panel"><h2>' + icon('status') + ' Bulletin</h2>' + bulletinHTML(info.bulletin) + '</div>';
  if (stats) {
    html += '<div class="panel"><h2>' + icon('result') + ' Day stats</h2><div class="statgrid">'
      + statCell('Matches wrestled', stats.matchesWrestled + ' / ' + stats.matchesTotal)
      + statCell('Mat time', esc(fmtDur(stats.clockSec)))
      + statCell('Blood time', esc(fmtDur(stats.bloodSec)))
      + statCell('Pins', stats.pins) + statCell('Tech falls', stats.techFalls) + statCell('Majors', stats.majors)
      + statCell('Decisions', stats.decisions) + statCell('Mats', stats.mats)
      + statCell('Schools', stats.schools) + statCell('Unattached', stats.unattached)
      + statCell('Wrestlers', stats.wrestlers) + statCell('Points scored', stats.points)
      + statCell('Fastest pin', stats.fastestPin ? esc(stats.fastestPin.name + ' · ' + fmtDur(stats.fastestPin.sec)) : 'No pins yet')
      + '</div>' + infoRow('Schools here', (stats.schoolList || []).join(', ')) + '</div>';
  } else {
    html += '<div class="panel"><h2>' + icon('result') + ' Day stats</h2><p>Stats unavailable offline — placeholders until you reconnect.</p><div class="statgrid">'
      + ['Matches wrestled', 'Mat time', 'Pins', 'Tech falls', 'Majors', 'Decisions', 'Mats', 'Wrestlers'].map((l) => statCell(l + ' (placeholder)', '…')).join('') + '</div></div>';
  }
  if (board) html += matQueuesHTML(board.brackets, (info.rules && info.rules.restFloorMin) || 20);
  if (canEdit) html += '<div class="panel"><div class="row"><button class="big primary" id="hubedit">Edit tournament settings</button></div></div>';
  // Parent print control: the same organizer packet renderer, one tap away.
  html += '<div class="panel"><div class="row"><button class="big" id="hubpacket">Print packet</button></div>'
    + '<p class="hint">Brackets, bulletin, and mat run-order — the same packet the organizer prints.</p></div>';
  html += '<div id="hubbody"></div>';
  v.innerHTML = html;
  v.querySelectorAll('#hubpicks [data-t]').forEach((b) => b.onclick = () => { saveTid(b.dataset.t); tournament(); });
  const ed = document.getElementById('hubedit');
  if (ed) ed.onclick = () => setupEditor(t, 'hubbody', () => tournament());
  const hp = document.getElementById('hubpacket');
  if (hp) hp.onclick = () => { window.open('/api/packet/' + t, '_blank'); };
}

/* ---------------- Notes: household notes + coach feedback per wrestler ---------------- */
async function notesView() {
  const v = document.getElementById('view');
  if (!S.account) {
    v.innerHTML = '<div class="panel"><h2>Notes</h2><p>Notes are household-private. Continue as the demo parent to see them.</p>'
      + '<div id="notemsg"></div><div class="row"><button class="big primary" id="notelogin">Continue as Demo Parent</button></div></div>';
    document.getElementById('notelogin').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Loading…';
      try {
        const r = await api('/auth/login', { method: 'POST', body: { accountId: 'acc-guardian' } });
        S.token = r.token; S.account = r.account; notesView();
      } catch (err) {
        e.target.disabled = false; e.target.textContent = 'Continue as Demo Parent';
        document.getElementById('notemsg').innerHTML = '<p class="held">' + esc(err.message) + '</p>';
      }
    };
    return;
  }
  let mine = [];
  try { mine = (await api('/me/wrestlers')).wrestlers || []; } catch { /* offline */ }
  if (!mine.length) {
    v.innerHTML = '<div class="panel"><h2>Notes</h2>' + emptyWrap('notes', 'No wrestlers linked yet', 'Ask the organizer to link a wrestler to this account, or continue as the demo parent to explore.') + '</div>';
    return;
  }
  let html = '';
  for (const w of mine) {
    let notes = [];
    try { notes = (await api('/notes?tournamentId=' + curTid() + '&wrestlerId=' + w.id)).notes || []; } catch { /* offline */ }
    const coach = notes.filter((n) => n.author_role === 'coach');
    const rest = notes.filter((n) => n.author_role !== 'coach');
    html += '<div class="panel"><h2>' + esc(w.name) + '</h2>'
      + (coach.length ? '<h3>From the coach</h3>' + coach.map((n) => '<p>' + esc(n.body) + '</p>').join('') : '')
      + '<h3>Notes</h3>' + (rest.length
        ? rest.map((n) => '<p>' + esc(n.body) + ' <span class="sheetsub">· ' + esc(n.scope) + '</span></p>').join('')
        : '<p>No notes yet — notes you save for this wrestler show here.</p>')
      + '<label>Add a note</label><textarea id="note-' + w.id + '" rows="2"></textarea>'
      + '<div class="row"><button class="big primary" data-note="' + w.id + '">Save note</button></div></div>';
  }
  if (S.account && S.account.role === 'guardian') {
    html += '<div class="panel"><h2>Family sharing</h2>'
      + '<label>Share a wrestler with family</label><div class="row"><select id="sharewho">'
      + mine.map((w) => '<option value="' + w.id + '">' + esc(w.name) + '</option>').join('') + '</select>'
      + '<button class="big" id="sharego">Create invite</button></div>'
      + '<p class="hint" id="sharewhat">After you tap Create invite, this panel shows a scan code (QR) plus a short manual code for the same invite, its expiry, and Copy / Revoke controls. No passwords are ever shared.</p>'
      + '<div id="sharemsg"></div>'
      + '<label>Accept a family invite</label><div class="row"><input id="accepttok" type="text" placeholder="Invite code">'
      + '<button class="big" id="acceptgo">Accept</button></div><div id="acceptmsg"></div></div>';
  }
  v.innerHTML = html;
  const sharego = document.getElementById('sharego');
  if (sharego) sharego.onclick = async () => {
    const msg = document.getElementById('sharemsg');
    try {
      const inv = await api('/sharing/invite', { method: 'POST', body: { wrestlerId: document.getElementById('sharewho').value } });
      const when = (() => { try { return new Date(inv.expires_at).toLocaleString(); } catch { return inv.expires_at; } })();
      msg.innerHTML = '<div class="sheetlink">' + qrSvg('arena:invite:' + inv.token, 112)
        + '<div><p style="margin:0">Manual code: <b class="bigcode">' + esc(inv.code) + '</b></p>'
        + '<p style="margin:0">Expires: ' + esc(when) + '</p>'
        + '<p class="hint" style="margin:0">The other guardian scans the code or types the manual code under Accept. Either one grants the same invite; no passwords are shared.</p></div></div>'
        + '<div class="row"><button class="big" id="sharecopy">Copy code</button>'
        + '<button class="big" id="sharerevoke">Revoke</button></div><div id="sharestat"></div>';
      const stat = document.getElementById('sharestat');
      document.getElementById('sharecopy').onclick = async () => {
        const text = 'Arena family invite code: ' + inv.code + ' (expires ' + when + ')';
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
          else throw new Error('no clipboard');
          stat.innerHTML = '<p class="clear">Copied.</p>';
        } catch { stat.innerHTML = '<p>Copy this: <b>' + esc(inv.code) + '</b></p>'; }
      };
      document.getElementById('sharerevoke').onclick = async () => {
        try {
          await api('/sharing/revoke', { method: 'POST', body: { token: inv.token } });
          // Hide the dead credentials: the QR and manual code no longer work,
          // so they no longer display. Only the note remains.
          msg.innerHTML = '<p class="clear">Revoked — the scan code and manual code no longer work, so they are hidden. Create a new invite to share again.</p>';
        } catch (e) { stat.innerHTML = '<p class="held">' + esc(e.message) + '</p>'; }
      };
    } catch (e) { msg.innerHTML = '<p class="held">' + esc(e.message) + '</p>'; }
  };
  const acceptgo = document.getElementById('acceptgo');
  if (acceptgo) acceptgo.onclick = async () => {
    const msg = document.getElementById('acceptmsg');
    const token = document.getElementById('accepttok').value.trim();
    if (!token) return;
    try {
      await api('/sharing/accept', { method: 'POST', body: { token } });
      msg.innerHTML = '<p class="clear">Linked — their wrestler now shows in your list.</p>';
    } catch (e) { msg.innerHTML = '<p class="held">' + esc(e.message) + '</p>'; }
  };
  v.querySelectorAll('[data-note]').forEach((b) => b.onclick = async () => {
    const body = document.getElementById('note-' + b.dataset.note).value.trim();
    if (!body) return;
    try {
      await api('/notes', { method: 'POST', body: { wrestlerId: b.dataset.note, tournamentId: curTid(), body, scope: 'private' } });
      notesView();
    } catch (e) { alert(e.message); }
  });
}

/* ---------------- Table: scoreboard-first view for table workers ---------------- */
async function tableView() {
  const v = document.getElementById('view');
  if (!S.account) {
    v.innerHTML = '<div class="panel"><h2>Table</h2><p>Table tools need a signed-in table worker.</p>'
      + '<div class="row"><button class="big primary" id="tablelogin">Continue as Table Worker 1</button></div></div>';
    document.getElementById('tablelogin').onclick = async () => {
      try {
        const r = await api('/auth/login', { method: 'POST', body: { accountId: 'acc-table1' } });
        S.token = r.token; S.account = r.account; tableView();
      } catch (e) { alert(e.message); }
    };
    return;
  }
  let list = [];
  try { list = (await api('/tournaments')).tournaments || []; } catch { list = []; }
  if (!list.some((t) => t.id === S.tournamentId) && list[0]) saveTid(list[0].id);
  v.innerHTML = '<div class="panel"><h2>Table</h2><p>Signed in as ' + esc(S.account.name) + ' (' + esc(S.account.role) + ')</p>'
    + '<label>Tournament</label><div class="chipline" id="tablepicks">' + list.map((t) =>
      '<button class="chip' + (t.id === S.tournamentId ? ' on' : '') + '" data-t="' + t.id + '">' + esc(t.name) + '</button>').join('')
    + '</div><div class="row"><button class="big primary" id="ttable2">Open scoreboard</button></div></div><div id="tlog"></div><div id="orgbody"></div>';
  v.querySelectorAll('#tablepicks [data-t]').forEach((b) => b.onclick = () => { saveTid(b.dataset.t); tableView(); });
  document.getElementById('ttable2').onclick = () => tableMode();
  renderTableLog('tlog', S.tournamentId || 'demo-tournament', '1', null);
}

/* ---------------- Bracket Generator (same engine, same print) ---------------- */
async function guest() {
  const v = document.getElementById('view');
  let gseed = 'entered', glayout = 'compact';
  const scanned = scannedBrackets();
  const scanHtml = '<div class="panel"><h2>Viewable Brackets</h2>'
    + '<p class="hint">Brackets scanned or opened on this device accumulate here. Opening one shows its public view only.</p>'
    + (scanned.length
      ? scanned.map((s) => '<div class="row"><button class="big" data-scan="' + esc(s.id) + '">' + esc(s.division || s.id) + '</button></div>').join('')
      : emptyWrap('scanned', 'No viewable brackets yet', 'Open any bracket sheet — or paste its link below — and it lands here for quick viewing.'))
    + '<label>Add a bracket link</label><div class="row"><input id="scanadd" type="text" placeholder="#b=bracket-id">'
    + '<button class="big" id="scanaddgo">Add</button></div><div id="scanmsg"></div></div>';
  v.innerHTML = scanHtml
    + '<div class="panel noprint"><h2>Bracket Generator</h2><p>Free, no account. Same deterministic engine and same print renderer as tournament brackets.</p>'
    + '<label>Print title (tournament name)</label><input id="gtitle" type="text" value="Bracket Generator">'
    + '<label>Event date</label><input id="gdate" type="date" value="">'
    + '<label>Names (one per line)</label><textarea id="gnames" rows="8">Avery\nBlake\nCasey\nDevon\nEmery\nFinley</textarea>'
    + '<label>Seeding</label><div class="chipline" id="gseed">'
    + '<button class="chip on" data-seed="entered">As entered</button>'
    + '<button class="chip" data-seed="alpha">A–Z</button>'
    + '<button class="chip" data-seed="random">Random draw</button></div>'
    + '<label>Format</label><select id="gfmt"><option value="double-elim">Double elimination</option><option value="round-robin">Round robin</option></select>'
    + '<label>Print layout</label><div class="chipline" id="glayout">'
    + '<button class="chip on" data-layout="compact">Multiple per page</button>'
    + '<button class="chip" data-layout="full">One per page, landscape</button></div>'
    + '<button class="big primary" id="ggo">Generate</button></div><div id="gout" class="print-keep" data-print-layout="compact"></div>';
  const pickRow = (id, attr, set) => {
    document.querySelectorAll('#' + id + ' .chip').forEach((c) => c.onclick = () => {
      set(c.dataset[attr]);
      document.querySelectorAll('#' + id + ' .chip').forEach((x) => x.classList.toggle('on', x === c));
    });
  };
  pickRow('gseed', 'seed', (x) => { gseed = x; });
  pickRow('glayout', 'layout', (x) => {
    glayout = x;
    document.getElementById('gout').dataset.printLayout = x;
  });
  document.getElementById('ggo').onclick = async () => {
    let names = document.getElementById('gnames').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (gseed === 'alpha') names = [...names].sort((a, b) => a.localeCompare(b));
    if (gseed === 'random') names = [...names].sort(() => Math.random() - 0.5);
    const out = await api('/guest/bracket', { method: 'POST', body: { names, format: document.getElementById('gfmt').value } });
    const gout = document.getElementById('gout');
    gout.dataset.printLayout = glayout;
    gout.innerHTML = '<div class="bracket-sheet" id="guestsheet"></div>'
      + '<div class="row noprint"><button class="big primary" id="gprint">Print bracket</button></div>';
    const title = document.getElementById('gtitle').value.trim() || 'Bracket Generator';
    const gdate = document.getElementById('gdate').value;
    window.Bracket.renderSheet(document.getElementById('guestsheet'), {
      title,
      sub: (gdate ? fmtDate(gdate) : new Date().toLocaleDateString()) + ' · ' + names.length + ' wrestlers · ' + out.matches.length + ' matches — fill in scores by hand',
      format: out.format, matches: out.matches,
    });
    document.getElementById('gprint').onclick = () => {
      document.body.classList.add('printing-bracket');
      window.print();
    };
  };
  v.querySelectorAll('[data-scan]').forEach((b) => b.onclick = () => {
    try { location.hash = bracketShortLink(b.dataset.scan); } catch { /* no history */ }
    S.afterSpectator = { expand: b.dataset.scan, match: null };
    setMode('spectator');
  });
  document.getElementById('scanaddgo').onclick = () => {
    const raw = document.getElementById('scanadd').value.trim();
    const msg = document.getElementById('scanmsg');
    const m = raw.match(/#b=([A-Za-z0-9_-]+)/) || raw.match(/^([A-Za-z0-9_-]{2,64})$/);
    if (!m) { msg.innerHTML = '<p class="held">Paste a bracket link like #b=bracket-id.</p>'; return; }
    rememberScanned(decodeURIComponent(m[1]), decodeURIComponent(m[1]));
    guest();
  };
}

/* ---------------- About (organizer/developer honesty panel) ---------------- */
async function about() {
  const modal = document.getElementById('modal');
  modal.hidden = false;
  modal.innerHTML = '<div class="modalcard" role="dialog" aria-label="About"><h2>About</h2><div class="loading"><div class="skel"></div></div></div>';
  let st = { mode: 'unknown' };
  try { st = await api('/meta/status'); } catch { /* offline */ }
  let srcline = 'Data source: unavailable offline.';
  try {
    const list = (await api('/tournaments')).tournaments || [];
    const demos = list.filter((t) => t.demo).map((t) => t.name);
    const real = list.filter((t) => !t.demo).map((t) => t.name);
    srcline = 'Data: ' + (demos.length ? 'DEMO DATA (' + demos.join(', ') + ')' : 'no demo')
      + ' · ' + (real.length ? 'Real tournaments: ' + real.join(', ') : 'no real tournaments');
  } catch { /* offline */ }
  const live = st.mode === 'real';
  modal.innerHTML = '<div class="modalcard" role="dialog" aria-modal="true" aria-label="About">'
    + '<h2>Architecture / About</h2>'
    + '<p><span class="pill ' + (live ? 'p-done' : 'p-todo') + '">' + (live ? 'LIVE — real Meta API' : 'MOCK — development fallback') + '</span></p>'
    + infoRow('Provider flag', st.flag || 'not configured')
    + infoRow('Card art model', (st.models && st.models.image) || 'model defaults')
    + infoRow('Setup model', (st.models && st.models.wonder) || 'model defaults')
    + infoRow('Explanations model', (st.models && st.models.spark) || 'model defaults')
    + infoRow('Photo cut-out model', (st.models && st.models.sam) || 'model defaults')
    + infoRow('Voice model', (st.models && st.models.voice) || 'model defaults')
    + '<p>' + esc(st.note || '') + '</p>'
    + '<p>' + esc(srcline) + '</p>'
    + '<p>Card art: generated image, uploaded photo, or a labeled SAMPLE ART placeholder — check the ribbon on each card.</p>'
    + '<div class="row"><button class="big primary" id="modalclose">Close</button></div></div>';
  document.getElementById('modalclose').onclick = () => { modal.hidden = true; };
  modal.onclick = (e) => { if (e.target === modal) modal.hidden = true; };
}

const ROLE_TABS = {
  parent: ['wrestler', 'spectator', 'tournament', 'notes'],
  organizer: ['organizer', 'spectator', 'tournament'],
  table: ['table', 'spectator', 'tournament'],
};
const ROLE_DEMO_ACCOUNT = { parent: 'acc-guardian', organizer: 'acc-organizer', table: 'acc-table1' };
const GUEST_TABS = ['spectator', 'tournament', 'guest'];
const GUEST_OK = ['spectator', 'tournament', 'guest', 'landing'];
const TABLE_OK = ['table', 'spectator', 'tournament', 'landing'];
function tabsFor() { return S.session === 'guest' ? GUEST_TABS : (ROLE_TABS[S.role] || ROLE_TABS.parent); }
function menuKey() { return S.session === 'guest' ? 'guest' : (S.role || 'parent'); }
function paintSession() {
  const chip = document.getElementById('sessionchip');
  if (!S.session && !S.account) {
    // Signed out: no role pill at all (fresh-load state, never a stale name).
    chip.hidden = true;
    chip.textContent = '';
  } else {
    const label = S.session === 'guest' ? 'Guest' : S.session === 'demo' ? 'DEMO'
      : S.role === 'organizer' ? 'Organizer' : S.role === 'table' ? 'Table Worker'
      : S.account ? S.account.name : 'Parent';
    chip.hidden = !label;
    chip.textContent = label;
  }
  paintDemoTag();
  const key = menuKey();
  document.querySelectorAll('#menupanel button[data-min]').forEach((b) => {
    b.hidden = !String(b.dataset.min).split(',').includes(key);
  });
}
function setMode(mode) {
  if (S.session === 'guest' && !GUEST_OK.includes(mode)) { guestBlocked(mode); return; }
  if (S.session !== 'guest' && S.role === 'table' && !TABLE_OK.includes(mode)) { tableBlocked(mode); return; }
  S.mode = mode;
  document.body.classList.toggle('landing', mode === 'landing');
  document.querySelectorAll('.modemenu button[data-mode], #menupanel button[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  document.getElementById('menupanel').hidden = true;
  document.getElementById('menubtn').setAttribute('aria-expanded', 'false');
  paintSession();
  // Shimmer skeleton + a sub-300ms settle on every switch; the view replaces
  // the skeleton as soon as its data lands, so text never waits on motion.
  const skel = document.getElementById('view');
  skel.innerHTML = viewSkeleton(mode);
  skel.classList.remove('viewswap');
  void skel.offsetWidth;
  skel.classList.add('viewswap');
  ({ landing, wrestler: myWrestler, spectator, tournament, notes: notesView, organizer, table: tableView, guest, studio: () => window.Studio?.open() })[mode]();
}
function guestBlocked(mode) {
  S.mode = mode;
  paintSession();
  const v = document.getElementById('view');
  v.innerHTML = '<div class="panel"><h2>Guests can\'t open that</h2><p>Guests get public views and the Bracket Generator. The rest needs the demo or sign-in.</p>'
    + '<div class="row"><button class="big primary" id="gbdemo">Continue as Demo</button><button class="big" id="gbback">Back</button></div></div>';
  document.getElementById('gbdemo').onclick = (e) => startSession({ session: 'demo', role: 'parent', accountId: 'acc-guardian' }, e.target);
  document.getElementById('gbback').onclick = () => setMode('spectator');
}
function tableBlocked(mode) {
  S.mode = mode;
  paintSession();
  const v = document.getElementById('view');
  v.innerHTML = '<div class="panel"><h2>Table workers can\'t open that</h2><p>This login covers assigned mats and matches only — no parent profiles, notes, or studio. Sign out to use another login.</p>'
    + '<div class="row"><button class="big primary" id="tbback">Back to Table</button></div></div>';
  document.getElementById('tbback').onclick = () => setMode('table');
}
function paintTabs() {
  const tabs = tabsFor();
  document.querySelectorAll('.modemenu button[data-mode]').forEach((b) => { b.hidden = !tabs.includes(b.dataset.mode); });
}
function applyRole() {
  paintTabs();
  const tabs = tabsFor();
  if (!tabs.includes(S.mode) && !['studio', 'guest'].includes(S.mode)) setMode(tabs[0]);
  else setMode(S.mode === 'landing' ? tabs[0] : S.mode);
}
// Separate logins per role, chosen on the landing page. There is no in-app
// role switch: to change roles, sign out and pick another login.
async function startSession(spec, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  document.getElementById('view').innerHTML = '<div class="loading" aria-live="polite"><div class="skel"></div><p>Loading…</p></div>';
  S.session = spec.session; saveSession();
  S.role = spec.role || 'parent';
  try { localStorage.setItem('fa-role', S.role); } catch { /* private mode */ }
  if (spec.accountId) {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { accountId: spec.accountId } });
      S.token = r.token; S.account = r.account;
    } catch { S.token = null; S.account = null; }
  } else {
    S.token = null; S.account = null;
  }
  applyRole();
}
async function bootSession() {
  if (!S.session) { setMode('landing'); return; }
  if (S.session !== 'guest' && !S.token) {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { accountId: ROLE_DEMO_ACCOUNT[S.role] || 'acc-guardian' } });
      S.token = r.token; S.account = r.account;
    } catch { /* offline: views degrade gracefully */ }
  }
  applyRole();
}
function landing() {
  const v = document.getElementById('view');
  const demoNote = 'Demo session role for demo purposes only — this repo has no real authentication backend.';
  v.innerHTML = '<div class="panel landhero"><div class="landmark">' + LOGO_MARK + '</div><h2 class="heroname">Folkstyle Arena</h2><div class="emptywrap">' + ILLUS.hero + '</div><p>Tournament day: wrestlers, brackets, mats, and cards.</p></div>'
    + '<div class="panel"><button class="big primary landbtn" id="landemo">Continue as Demo</button>'
    + '<p class="hint">The full demo tournament. Clearly labeled DEMO DATA on every page.</p></div>'
    + '<div class="panel"><button class="big landbtn" id="lanparent">Parent sign-in</button>'
    + '<p class="hint">Your wrestlers, brackets, bulletin, notes, and cards. ' + demoNote + '</p></div>'
    + '<div class="panel"><button class="big landbtn" id="lanorg">Organizer sign-in</button>'
    + '<p class="hint">Tournament setup, settings, bulletins, and results controls. ' + demoNote + '</p></div>'
    + '<div class="panel"><button class="big landbtn" id="lantable">Table Worker sign-in</button>'
    + '<p class="hint">Assigned mats and matches only: scoring, undo, clocks. ' + demoNote + '</p></div>'
    + '<div class="panel"><button class="big landbtn" id="languest">Continue as Guest</button>'
    + '<p class="hint">Public views and the Bracket Generator only. No saved profile or private notes. Labeled Guest.</p></div>';
  document.getElementById('landemo').onclick = (e) => startSession({ session: 'demo', role: 'parent', accountId: 'acc-guardian' }, e.target);
  document.getElementById('lanparent').onclick = (e) => startSession({ session: 'authed', role: 'parent', accountId: 'acc-guardian' }, e.target);
  document.getElementById('lanorg').onclick = (e) => startSession({ session: 'authed', role: 'organizer', accountId: 'acc-organizer' }, e.target);
  document.getElementById('lantable').onclick = (e) => startSession({ session: 'authed', role: 'table', accountId: 'acc-table1' }, e.target);
  document.getElementById('languest').onclick = (e) => startSession({ session: 'guest' }, e.target);
}

document.querySelectorAll('.modemenu button[data-mode], #menupanel button[data-mode]').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
document.getElementById('menubtn').onclick = () => {
  const p = document.getElementById('menupanel');
  p.hidden = !p.hidden;
  document.getElementById('menubtn').setAttribute('aria-expanded', String(!p.hidden));
};
document.getElementById('aboutbtn').onclick = about;
document.getElementById('aboutbtn2').onclick = about;
document.getElementById('switchsession').onclick = () => {
  // Sign out clears ALL session state at the root: identity, grant, selected
  // wrestler, cached authed responses, and UI expansion — then restores the
  // fresh-load landing (no pill, all tabs, landing view). The server grant is
  // dropped best-effort so offline sign-out still works.
  const grant = S.token;
  S.session = null; saveSession();
  S.token = null; S.account = null; S.role = 'parent';
  S.wrestlerId = null; S.cache = {}; S.expanded = []; S.afterSpectator = null; S.clubFilter = null;
  try { localStorage.setItem('fa-role', 'parent'); } catch { /* private mode */ }
  if (grant) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + grant } }).catch(() => {});
  document.querySelectorAll('.modemenu button[data-mode]').forEach((b) => { b.hidden = false; });
  setMode('landing');
};
async function runSearch(q) {
  q = String(q || '').trim();
  const box = document.getElementById('searchresults');
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<div class="panel"><p>Searching…</p></div>';
  try {
    const r = await api('/search?q=' + encodeURIComponent(q) + (S.tournamentId ? '&tournamentId=' + S.tournamentId : ''));
    let res = r.results || [];
    // Table logins never open parent profiles; organizer logins never open
    // parent profiles or private notes either (their view is setup/results).
    // The server additionally withholds private notes from table and guests.
    // Withheld rows are always LABELED, never silently dropped to empty.
    let withheld = '';
    const isTable = S.session !== 'guest' && S.role === 'table';
    const isOrg = S.session !== 'guest' && S.role === 'organizer';
    const hideKinds = isTable ? ['wrestler'] : isOrg ? ['wrestler', 'note'] : [];
    if (hideKinds.length && res.some((x) => hideKinds.includes(x.kind))) {
      res = res.filter((x) => !hideKinds.includes(x.kind));
      withheld = isTable
        ? '<p class="hint">Wrestler profiles are hidden for Table Worker logins — assigned mats and matches only.</p>'
        : '<p class="hint">Wrestler profiles and private notes stay in the parent login — hidden here.</p>';
    }
    if (!res.length) { box.innerHTML = '<div class="panel"><p>No matches for “' + esc(q) + '”.</p>' + withheld + '</div>'; return; }
    box.innerHTML = '<div class="panel"><h3>Results</h3>' + withheld + res.map((x, i) =>
      '<button class="srrow" data-sr="' + i + '"><span class="srkind">' + esc(x.kind) + '</span><span>' + esc(x.label) + '</span></button>').join('') + '</div>';
    box.querySelectorAll('[data-sr]').forEach((b) => b.onclick = () => {
      const x = res[Number(b.dataset.sr)];
      box.hidden = true;
      if (x.kind === 'wrestler' && x.id) { S.wrestlerId = x.id; setMode('wrestler'); }
      else if (x.kind === 'bracket' && x.id) { S.afterSpectator = { expand: x.id, match: null }; setMode('spectator'); }
      else if (x.kind === 'bout' && x.bracketId) { S.afterSpectator = { expand: x.bracketId, match: x.id }; setMode('spectator'); }
      else if (x.kind === 'club') { S.clubFilter = { club: x.id, members: x.members || [] }; setMode('spectator'); }
      else if (x.kind === 'note') { setMode('notes'); }
    });
  } catch (err) { box.innerHTML = '<div class="panel"><p>' + esc(err.message) + '</p></div>'; }
}
// Results as-you-type (debounced), plus Enter/change for keyboards.
let searchTimer = null;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(e.target.value), 220);
});
document.getElementById('search').addEventListener('change', (e) => {
  clearTimeout(searchTimer);
  runSearch(e.target.value);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.getElementById('modal').hidden = true;
  document.getElementById('menupanel').hidden = true;
  document.getElementById('searchresults').hidden = true;
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
document.getElementById('set-rm').addEventListener('change', (e) => {
  if (!S.settings) loadSettings();
  S.settings.reduceMotion = e.target.checked; saveSettings(); applySettings();
});
document.getElementById('set-hc').addEventListener('change', (e) => {
  if (!S.settings) loadSettings();
  S.settings.highContrast = e.target.checked; saveSettings(); applySettings();
});
applySettings();
bootSession();
