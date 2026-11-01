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
function saveTid(id) { S.tournamentId = id; try { localStorage.setItem('fa-tid', id); } catch { /* private mode */ } }
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
const BULL_SECTIONS = ['Alerts', 'Parking', 'Snacks', 'Raffles', 'Info'];
function parseBulletin(lines) {
  const out = { Alerts: [], Parking: [], Snacks: [], Raffles: [], Info: [] };
  for (const raw of lines || []) {
    const m = String(raw).match(/^\[(Alerts?|Parking|Snacks?|Raffles?|Info|General)\]\s*([\s\S]*)$/i);
    let sec = 'Info';
    let text = String(raw);
    if (m) {
      text = m[2];
      const k = m[1].toLowerCase();
      sec = k.startsWith('alert') ? 'Alerts' : k.startsWith('park') ? 'Parking' : k.startsWith('snack') ? 'Snacks' : k.startsWith('raffl') ? 'Raffles' : 'Info';
    } else {
      const low = text.toLowerCase();
      if (/alert|urgent|clos|emergency|delay/.test(low)) sec = 'Alerts';
      else if (/park/.test(low)) sec = 'Parking';
      else if (/snack|concession|food/.test(low)) sec = 'Snacks';
      else if (/raffle/.test(low)) sec = 'Raffles';
    }
    out[sec].push(text);
  }
  return out;
}
function bulletinHTML(lines) {
  const g = parseBulletin(lines);
  const shown = BULL_SECTIONS.filter((s) => g[s].length);
  if (!shown.length) return '<p>No announcements.</p>';
  return shown.map((s) => '<h3>' + s + '</h3>' + g[s].map((t) => '<p>' + esc(t) + '</p>').join('')).join('');
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
function matLabel(raw) { const n = mapMat(raw); return n == null ? '—' : 'Mat ' + n; }
// Tournament-wide mat clock in match numbers (never clock times): the live
// bout if one is wrestling, else the next upcoming bout number on that mat.
function matNow(allMatches, mat) {
  const q = (allMatches || []).filter((m) => m.mat === mat && m.status !== 'completed' && m.bout != null)
    .sort((x, y) => x.bout - y.bout);
  if (!q.length) return null;
  const live = q.find((m) => m.live || m.status === 'in-progress');
  return { now: (live || q[0]).bout, live: !!live };
}
function boutEst(board, nextMatch) {
  if (!nextMatch || nextMatch.mat == null || nextMatch.bout == null) return null;
  const all = (board.brackets || []).flatMap((b) => b.matches || []);
  const now = matNow(all, nextMatch.mat);
  if (!now) return null;
  return { mat: mapMat(nextMatch.mat), now: now.now, yours: nextMatch.bout, away: nextMatch.bout - now.now };
}
function estStrip(e) {
  if (!e) return '';
  const away = e.away <= 0 ? 'on now' : '<b>' + e.away + ' bouts away</b>';
  return '<div class="eststrip">' + icon('mat') + ' Mat ' + esc(e.mat) + ' · Now: Match ' + esc(e.now)
    + ' · Your next: Match ' + esc(e.yours) + ' · ' + away + '</div>';
}
// '2026-11-07' -> 'Sat Nov 7, 2026' (parsed as local parts, never UTC-shifted).
function fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
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
function statusPill(m, board) {
  if (!m) return '';
  if (m.status === 'completed') return '<span class="pill p-done">' + icon('result') + ' Final</span>';
  if (m.live || m.status === 'in-progress') return '<span class="pill p-live">' + icon('status') + ' LIVE</span>';
  const tag = board ? queueTag(board, m) : null;
  if (tag === 'ondeck') return '<span class="pill p-mid">On deck</span>';
  if (tag === 'hole') return '<span class="pill p-todo">In the hole</span>';
  return '<span class="pill p-todo">Upcoming</span>';
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

const FINISHES = ['classic', 'shiny', 'fire', 'ice', 'lightning'];
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
    : m.live ? icon('status') + ' In progress · Match ' + esc(m.bout ?? '?') + ' · ' + matLabel(m.mat)
    : icon('mat') + ' Match ' + esc(m.bout ?? '?') + ' · ' + matLabel(m.mat);
  return '<div class="matchup">'
    + '<div class="side' + (winA ? ' winnerglow' : '') + '">' + cardFace({ template: { name: m.a } }, true) + '</div>'
    + '<div class="side' + (winB ? ' winnerglow' : '') + '">' + cardFace({ template: { name: m.b } }, true) + '</div>'
    + '</div><div class="boutmeta">' + statusPill(m, board) + ' ' + sub + '</div>';
}
function cardFace(card, mini = false) {
  if (!card) return '<div class="' + (mini ? 'minicard' : 'cardface') + ' fin-classic"><div class="inset"><div class="nameplate"><span>No card yet</span></div><div class="artwin"></div></div><div class="finish" aria-hidden="true"></div></div>';
  const t = card.template || {};
  const ribbon = card.artIsMock ? '<div class="artribbon">SAMPLE ART</div>' : '';
  const noart = !mini && !card.art ? '<div class="noart">No photo yet</div>' : '';
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
  const nx = snap.next || {};
  const sq2 = nx.current ? '<div class="square now"><span class="k">NEXT MATCH</span><span class="v">NOW · ' + esc(nx.bout_number ?? '') + '</span></div>'
    : nx.bout_number != null ? '<div class="square"><span class="k">NEXT MATCH</span><span class="v">' + esc(nx.bout_number) + '</span></div>'
      : '<div class="square"><span class="k">NEXT MATCH</span><span class="v">—</span></div>';
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
  if (!heroM) { heroM = lastDone(S.wrestlerId); heroTag = heroM ? 'LAST BOUT' : null; }
  const heroEst = heroM && heroTag !== 'LAST BOUT' ? boutEst(board, heroM) : null;
  const heroOpp = heroM ? (heroM.aid === S.wrestlerId ? heroM.b : heroM.a) : null;
  const hero = heroM ? '<div class="panel hero"><div class="herotop">' + statusPill(heroM, board)
    + '<span class="herotag">' + esc(heroTag) + '</span></div>'
    + '<h2 class="heroname">' + esc(snap.wrestler.name) + '</h2>'
    + (heroTag !== 'LAST BOUT' && heroOpp ? '<div class="heroopp">vs ' + esc(heroOpp) + ' · Match ' + esc(heroM.bout ?? '?') + ' · ' + matLabel(heroM.mat) + '</div>' : '')
    + (heroEst ? estStrip(heroEst) : '')
    + matchupHTML(heroM, board) + '</div>' : '';
  let bouts = '';
  for (const kid of kids) {
    if (kid.id === S.wrestlerId) continue; // hero panel above covers the selected wrestler
    let s = null;
    try { s = await api('/wrestler/' + kid.id + '/snapshot' + (S.tournamentId ? '?tournamentId=' + S.tournamentId : '')); } catch { continue; }
    let m = s.next ? findMatch(s.next.bracket_id, s.next.match_id) : null;
    let tag = m ? (s.next.current ? 'NOW' : 'UP NEXT') : null;
    if (!m) { m = lastDone(kid.id); tag = m ? 'LAST BOUT' : null; }
    if (!m) continue;
    bouts += '<div class="panel"><h3>' + esc(tag) + ' · ' + esc(kid.name) + '</h3>' + matchupHTML(m, board) + '</div>';
  }
  const r = snap.rest || {};
  const restLine = r.state === 'held'
    ? '<p class="held">' + icon('rest') + ' Rest held — ' + esc(r.message || '') + '</p>'
    : '<p class="clear">' + icon('result') + ' ' + esc(r.message || 'Clear to wrestle.') + '</p>';
  const restRule = r.floorMin != null
    ? '<p class="hint">Rest rule: ' + esc(r.floorMin) + ' min between bouts'
      + (r.lastEnd ? ' · last bout ended ' + esc(new Date(r.lastEnd).toLocaleTimeString()) : ' · no bouts yet today')
      + (heroEst && heroEst.away > 0 ? ' · ' + heroEst.away + ' bouts away' : '') + '.</p>' : '';
  const switcher = mine.length > 1 ? '<div class="panel"><h3>My Wrestlers</h3><div class="chipline" id="kidswitch">'
    + mine.map((w) => '<button class="chip' + (w.id === S.wrestlerId ? ' on' : '') + '" data-w="' + w.id + '">' + esc(w.name) + '</button>').join('')
    + '</div><div id="prox"></div><div class="row"><button class="big" id="famlink">Family sharing</button></div></div>' : '';
  v.innerHTML = '<section aria-label="My Wrestler">'
    + hero + switcher
    + '<div class="panel"><div class="row"><div><h2 style="margin:0">' + avatar(snap.wrestler.name) + ' ' + esc(snap.wrestler.name) + '</h2>'
    + '<div style="color:var(--muted)">Grade ' + esc(snap.wrestler.grade) + '</div>'
    + '<div style="margin-top:6px">' + schoolChip(snap.wrestler.team) + '</div></div>'
    + '<div class="squares"><div class="square"><span class="k">' + icon('mat') + ' MAT</span><span class="v">' + esc(nx.mat == null ? '—' : mapMat(nx.mat)) + '</span></div>' + sq2 + '</div></div>'
    + restLine + restRule
    + '</div>'
    + '<div class="cardframe">' + cardFace(snap.card) + '</div>'
    + bouts
    + '<div class="split">'
    + ((snap.notes && snap.notes.some((n) => n.author_role !== 'coach')) ? '<div class="panel"><h3>Notes</h3><p>' + snap.notes.filter((n) => n.author_role !== 'coach').map((n) => esc(n.body)).join('</p><p>') + '</p></div>' : '')
    + ((snap.coachFeedback && snap.coachFeedback.length) ? '<div class="panel"><h3>From the coach</h3><p>' + snap.coachFeedback.map(esc).join('</p><p>') + '</p></div>' : '')
    + '</div>'
    + '<details class="menu"><summary>More</summary><div class="menubody">'
    + '<div class="panel"><h3>Today</h3><p>' + esc(snap.today || 'No bouts yet today.') + '</p></div>'
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
  let team = '<div class="panel"><h2>Team</h2>';
  for (const t of data.team || []) {
    const sq2 = t.current ? '<div class="square now"><span class="k">NEXT BOUT</span><span class="v">NOW · BOUT</span></div>'
      : t.nextBout != null ? '<div class="square"><span class="k">NEXT BOUT</span><span class="v">' + esc(t.nextBout) + '</span></div>'
        : '<div class="square"><span class="k">NEXT BOUT</span><span class="v">—</span></div>';
    team += '<div class="teammate">' + avatar(t.name) + '<div class="who">' + esc(t.name)
      + '<div>' + schoolChip(t.team) + '</div>' + (t.held ? '<div class="held">' + icon('rest') + ' HELD — rest</div>' : '')
      + '</div><div class="squares"><div class="square"><span class="k">' + icon('mat') + ' MAT</span><span class="v">' + esc(t.mat == null ? '—' : mapMat(t.mat)) + '</span></div>' + sq2 + '</div></div>';
  }
  team += '</div>';
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
  const rowStatus = (b) => {
    const ms = b.matches || [];
    const done = ms.filter((m) => m.status === 'completed').length;
    const live = ms.filter((m) => m.live || m.status === 'in-progress').length;
    if (ms.length && done === ms.length) return { t: 'Complete', c: 'done' };
    if (live) return { t: 'Live ' + live, c: 'live' };
    if (done) return { t: done + ' of ' + ms.length + ' decided', c: 'mid' };
    return { t: 'Upcoming', c: 'todo' };
  };
  const wcount = (b) => new Set((b.matches || []).flatMap((m) => [m.aid, m.bid]).filter(Boolean)).size;
  const isComplete = blist.length > 0 && blist.every((b) => (b.matches || []).length > 0 && (b.matches || []).every((m) => m.status === 'completed'));
  const bracketRow = (b, isPinned) => {
    const st = rowStatus(b);
    const band = parseDiv(b.division).band;
    return '<div class="brow2" data-brow="' + b.id + '">'
      + '<button class="browmain" data-expand="' + b.id + '" aria-expanded="false"><span class="browtitle">' + icon('weight') + ' ' + esc(b.division) + '</span>'
      + '<span class="browsub">' + (band ? esc(band) + ' · ' : '') + wcount(b) + ' wrestlers · <span class="pill p-' + st.c + '">' + esc(st.t) + '</span></span></button>'
      + '<button class="pinbtn' + (isPinned ? ' on' : '') + '" data-pin="' + b.id + '" aria-label="' + (isPinned ? 'Unpin ' : 'Pin ') + esc(b.division) + '">' + (isPinned ? '★' : '☆') + '</button></div>'
      + '<div class="bracket-sheet" data-mount="' + b.id + '" hidden></div>';
  };
  const pinned = pins.map((id) => blist.find((b) => b.id === id)).filter(Boolean);
  const rest = blist.filter((b) => !pins.includes(b.id));
  const groups = {};
  for (const b of rest) {
    const age = parseDiv(b.division).age;
    (groups[age] = groups[age] || []).push(b);
  }
  let brackets = '<div class="panel"><div class="row"><h2 style="margin:0">Brackets</h2>'
    + '<button class="big" id="brkrefresh" style="margin-left:auto">Refresh</button></div><div id="brkdetail"></div>'
    + (isComplete ? '<p class="clear">' + icon('result') + ' Tournament complete — results are read-only.</p>' : '')
    + '<div id="brklist">'
    + (pinned.length ? '<h3 class="pinhead">Pinned</h3>' + pinned.map((b) => bracketRow(b, true)).join('') : '')
    + Object.entries(groups).map(([age, arr]) => '<h3>' + esc(age) + '</h3>' + arr.map((b) => bracketRow(b, false)).join('')).join('')
    + (blist.length ? '' : '<p>No brackets published yet.</p>') + '</div></div>';
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
    const btn = v.querySelector('[data-expand="' + id + '"]');
    if (btn) { btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    if (!S.expanded.includes(id)) S.expanded.push(id);
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
  v.innerHTML = team + brackets + '<div class="panel"><h2>' + icon('status') + ' Bulletin</h2>' + bulletinHTML(data.bulletin) + '</div>' + gal;
  v.querySelectorAll('[data-expand]').forEach((btn) => btn.onclick = () => {
    const id = btn.dataset.expand;
    const mount = v.querySelector('[data-mount="' + id + '"]');
    if (mount && mount.hidden) paintOne(id);
    else foldOne(id);
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
  if (window.Bracket) window.Bracket.setTapHandler((t) => openMatchDetail(data, t.mid));
  for (const id of [...S.expanded]) paintOne(id);
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
    v.innerHTML = '<div class="panel"><h2>Sign in</h2><p>Organizer and table functions need a role-checked account.</p><div id="accts"></div></div>';
    const a = await api('/demo/accounts');
    document.getElementById('accts').innerHTML = a.accounts.map((x) =>
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

async function tableMode() {
  const body = document.getElementById('orgbody');
  const tid = S.tournamentId || 'demo-tournament';
  const name = prompt('Clock in — your name or identifier:', S.account.name) || S.account.name;
  try { await api('/table/clockin', { method: 'POST', body: { tournamentId: tid, table: '1', name } }); }
  catch (e) { body.innerHTML = '<div class="panel"><p>' + esc(e.message) + '</p></div>'; return; }
  let q;
  try { q = await api('/table/' + tid + '/queue?table=1'); } catch (e) { body.innerHTML = '<div class="panel"><p>' + esc(e.message) + '</p></div>'; return; }
  if (!q.queue.length) { body.innerHTML = '<div class="panel"><p>No bouts assigned to table 1.</p></div>'; return; }
  const m = q.queue[0];
  body.innerHTML = '<div class="panel"><h3>Table 1 · Bout ' + esc(m.bout_number ?? '?') + '</h3>'
    + '<p>' + esc(m.a) + ' (RED) vs ' + esc(m.b) + ' (GREEN)</p>'
    + (m.hold ? '<p class="held">' + esc(m.hold) + '</p>' : '')
    + '<table class="scores"><tr><th>RED</th><th>GREEN</th></tr><tr>'
    + '<td><button class="scorebtn red" data-s="red" data-p="1">+1</button> <button class="scorebtn red" data-s="red" data-p="2">+2</button> <button class="scorebtn red" data-s="red" data-p="3">+3</button></td>'
    + '<td><button class="scorebtn green" data-s="green" data-p="1">+1</button> <button class="scorebtn green" data-s="green" data-p="2">+2</button> <button class="scorebtn green" data-s="green" data-p="3">+3</button></td>'
    + '</tr></table><p>Score: <span id="live">0 – 0</span></p>'
    + '<div class="row"><button class="big" id="undo">UNDO</button><button class="big primary" id="final">Finalize</button></div></div>'
    + '<div class="panel"><h3>Clocks</h3><div class="row"><div><label>Match (sec)</label><input id="ckc" type="number" min="0"></div>'
    + '<div><label>Blood (sec)</label><input id="ckb" type="number" min="0"></div>'
    + '<div><label>Injury (sec)</label><input id="cki" type="number" min="0"></div></div>'
    + '<div class="row"><button class="big" id="ckgo">Save clocks</button></div><p id="ckmsg" class="hint">Blood and injury time never add to the match clock.</p></div>';
  body.querySelectorAll('.scorebtn').forEach((b) => b.onclick = async () => {
    const side = b.dataset.s, pts = Number(b.dataset.p);
    const live = await api('/table/score', { method: 'POST', body: { tournamentId: tid, bracketId: m.bracket_id, matchId: m.match_id, play: { side, points: pts, label: side + ' +' + pts } } });
    document.getElementById('live').textContent = live.red + ' – ' + live.green;
    document.getElementById('undo').textContent = 'UNDO: take back ' + side + ' +' + pts;
  });
  document.getElementById('undo').onclick = async () => {
    const r = await api('/table/undo', { method: 'POST', body: { tournamentId: tid, bracketId: m.bracket_id, matchId: m.match_id } });
    document.getElementById('live').textContent = r.live.red + ' – ' + r.live.green;
    document.getElementById('undo').textContent = 'Took back ' + r.undone.side + ' +' + r.undone.points + ' — UNDO';
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
  document.getElementById('final').onclick = async () => {
    const winner = prompt('Winner: RED or GREEN?', 'RED');
    const outcome = prompt('Outcome (pin/tech-fall/major/decision):', 'decision');
    try {
      await api('/table/finalize', { method: 'POST', body: { tournamentId: tid, bracketId: m.bracket_id, matchId: m.match_id, winner, outcome } });
      alert('Bout finalized.');
    } catch (e) { alert(e.message); }
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
    + '<label>Rest between bouts</label>' + pills('su-rest', 'rest', REST_OPTIONS, o.rest ?? 20, Object.fromEntries(REST_OPTIONS.map((r) => [r, r + ' min'])))
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
    try {
      await api('/tournaments/' + t + '/bulletin', { method: 'POST', body: { text } });
      msg.innerHTML = '<p class="clear">Posted.</p>';
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
        : m === pend[0] ? '<span class="qstate ondeck">On deck</span>'
        : m === pend[1] ? '<span class="qstate">In the hole</span>'
        : '<span class="qstate">Upcoming</span>';
      return '<div class="qrow"><span class="qbout">Match ' + esc(m.bout ?? '?') + '</span><span class="qwho">' + esc(m.a) + ' v ' + esc(m.b) + '</span>' + state + '</div>';
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
  const est = kidIn && m.bout != null && now
    ? { mat: mapMat(m.mat), now: now.now, yours: m.bout, away: m.bout - now.now } : null;
  mount.innerHTML = '<div class="panel matchdetail"><div class="row"><h3 style="margin:0">' + icon('status') + ' Match detail · ' + esc(b.division) + '</h3>'
    + '<button class="big" id="mdclose" style="margin-left:auto">Close</button></div>'
    + matchupHTML(m, board)
    + (est ? estStrip(est)
      : now ? '<div class="eststrip">' + icon('mat') + ' Mat ' + esc(mapMat(m.mat)) + ' · Now: Match ' + esc(now.now) + '</div>' : '')
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
    + infoRow('Rest between bouts', info.rules.restFloorMin + ' min')
    + infoRow('Bracket format', FORMAT_LABELS[d.defaultFormat] || d.defaultFormat)
    + infoRow('Entry fee', d.fee) + infoRow('Registration', d.regDetails)
    + infoRow('Tables', d.tables) + infoRow('Referees', d.referees) + infoRow('Head referee', d.headRef)
    + infoRow('Check-in times', d.weighins) + infoRow('Contact', d.contact) + infoRow('Notes', d.notes) + '</div>'
    + (d.raffle ? '<div class="banner"><b>Raffle:</b> ' + esc(d.raffle) + '</div>' : '')
    + '<div class="panel"><h2>' + icon('status') + ' Announcements</h2>' + bulletinHTML(info.bulletin) + '</div>';
  if (stats) {
    html += '<div class="panel"><h2>' + icon('result') + ' Day stats</h2><div class="statgrid">'
      + statCell('Matches wrestled', stats.matchesWrestled + ' / ' + stats.matchesTotal)
      + statCell('Mat time', esc(fmtDur(stats.clockSec)))
      + statCell('Blood time', esc(fmtDur(stats.bloodSec)))
      + statCell('Pins', stats.pins) + statCell('Tech falls', stats.techFalls) + statCell('Majors', stats.majors)
      + statCell('Decisions', stats.decisions) + statCell('Mats', stats.mats)
      + statCell('Schools', stats.schools) + statCell('Unattached', stats.unattached)
      + statCell('Wrestlers', stats.wrestlers) + statCell('Points scored', stats.points)
      + statCell('Fastest pin', stats.fastestPin ? esc(stats.fastestPin.name + ' · ' + fmtDur(stats.fastestPin.sec)) : '—')
      + '</div>' + infoRow('Schools here', (stats.schoolList || []).join(', ')) + '</div>';
  } else {
    html += '<div class="panel"><h2>' + icon('result') + ' Day stats</h2><p>Stats unavailable offline.</p></div>';
  }
  if (board) html += matQueuesHTML(board.brackets, (info.rules && info.rules.restFloorMin) || 20);
  if (canEdit) html += '<div class="panel"><div class="row"><button class="big primary" id="hubedit">Edit tournament settings</button></div></div>';
  html += '<div id="hubbody"></div>';
  v.innerHTML = html;
  v.querySelectorAll('#hubpicks [data-t]').forEach((b) => b.onclick = () => { saveTid(b.dataset.t); tournament(); });
  const ed = document.getElementById('hubedit');
  if (ed) ed.onclick = () => setupEditor(t, 'hubbody', () => tournament());
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
    v.innerHTML = '<div class="panel"><h2>Notes</h2><p>No wrestlers are linked to this account yet.</p></div>';
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
        : '<p>No notes yet.</p>')
      + '<label>Add a note</label><textarea id="note-' + w.id + '" rows="2"></textarea>'
      + '<div class="row"><button class="big primary" data-note="' + w.id + '">Save note</button></div></div>';
  }
  if (S.account && S.account.role === 'guardian') {
    html += '<div class="panel"><h2>Family sharing</h2>'
      + '<label>Share a wrestler with family</label><div class="row"><select id="sharewho">'
      + mine.map((w) => '<option value="' + w.id + '">' + esc(w.name) + '</option>').join('') + '</select>'
      + '<button class="big" id="sharego">Create invite</button></div><div id="sharemsg"></div>'
      + '<label>Accept a family invite</label><div class="row"><input id="accepttok" type="text" placeholder="Invite code">'
      + '<button class="big" id="acceptgo">Accept</button></div><div id="acceptmsg"></div></div>';
  }
  v.innerHTML = html;
  const sharego = document.getElementById('sharego');
  if (sharego) sharego.onclick = async () => {
    const msg = document.getElementById('sharemsg');
    try {
      const inv = await api('/sharing/invite', { method: 'POST', body: { wrestlerId: document.getElementById('sharewho').value } });
      msg.innerHTML = '<p>Invite code: <b>' + esc(inv.token) + '</b> (expires ' + esc(inv.expires_at) + '). The other guardian enters it under Accept.</p>';
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
    + '</div><div class="row"><button class="big primary" id="ttable2">Open scoreboard</button></div></div><div id="orgbody"></div>';
  v.querySelectorAll('#tablepicks [data-t]').forEach((b) => b.onclick = () => { saveTid(b.dataset.t); tableView(); });
  document.getElementById('ttable2').onclick = () => tableMode();
}

/* ---------------- Bracket Generator (same engine, same print) ---------------- */
async function guest() {
  const v = document.getElementById('view');
  let gseed = 'entered', glayout = 'compact';
  v.innerHTML = '<div class="panel noprint"><h2>Bracket Generator</h2><p>Free, no account. Same deterministic engine and same print renderer as tournament brackets.</p>'
    + '<label>Print title (tournament name)</label><input id="gtitle" type="text" value="Bracket Generator">'
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
    window.Bracket.renderSheet(document.getElementById('guestsheet'), {
      title,
      sub: new Date().toLocaleDateString() + ' · ' + names.length + ' wrestlers · ' + out.matches.length + ' bouts — fill in scores by hand',
      format: out.format, matches: out.matches,
    });
    document.getElementById('gprint').onclick = () => {
      document.body.classList.add('printing-bracket');
      window.print();
    };
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
    + infoRow('Provider flag', st.flag || '—')
    + infoRow('Models', st.models ? Object.values(st.models).join(', ') : '—')
    + '<p>' + esc(st.note || '') + '</p>'
    + '<p>' + esc(srcline) + '</p>'
    + '<p>Card art: generated image, uploaded photo, or a labeled SAMPLE ART placeholder — check the ribbon on each card.</p>'
    + '<div class="row"><button class="big primary" id="modalclose">Close</button></div></div>';
  document.getElementById('modalclose').onclick = () => { modal.hidden = true; };
  modal.onclick = (e) => { if (e.target === modal) modal.hidden = true; };
}

const ROLE_TABS = {
  parent: ['wrestler', 'spectator', 'tournament', 'notes'],
  organizer: ['organizer', 'spectator', 'tournament', 'notes'],
  table: ['table', 'spectator', 'tournament', 'notes'],
};
const ROLE_DEMO_ACCOUNT = { parent: 'acc-guardian', organizer: 'acc-organizer', table: 'acc-table1' };
const GUEST_TABS = ['spectator', 'tournament', 'guest'];
const GUEST_OK = ['spectator', 'tournament', 'guest', 'landing'];
function tabsFor() { return S.session === 'guest' ? GUEST_TABS : (ROLE_TABS[S.role] || ROLE_TABS.parent); }
function paintSession() {
  const chip = document.getElementById('sessionchip');
  const label = S.session === 'guest' ? 'Guest' : S.session === 'demo' ? 'DEMO' : S.account ? S.account.name : '';
  chip.hidden = !label;
  chip.textContent = label;
}
function setMode(mode) {
  if (S.session === 'guest' && !GUEST_OK.includes(mode)) { guestBlocked(mode); return; }
  S.mode = mode;
  document.body.classList.toggle('landing', mode === 'landing');
  document.querySelectorAll('.modemenu button[data-mode], #menupanel button[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  document.getElementById('menupanel').hidden = true;
  document.getElementById('menubtn').setAttribute('aria-expanded', 'false');
  paintSession();
  ({ landing, wrestler: myWrestler, spectator, tournament, notes: notesView, organizer, table: tableView, guest, studio: () => window.Studio?.open() })[mode]();
}
function guestBlocked(mode) {
  S.mode = mode;
  paintSession();
  const v = document.getElementById('view');
  v.innerHTML = '<div class="panel"><h2>Guests can\'t open that</h2><p>Guests get public views and the Bracket Generator. The rest needs the demo or sign-in.</p>'
    + '<div class="row"><button class="big primary" id="gbdemo">Continue as Demo</button><button class="big" id="gbback">Back</button></div></div>';
  document.getElementById('gbdemo').onclick = (e) => startSession('demo', e.target);
  document.getElementById('gbback').onclick = () => setMode('spectator');
}
function applyRole() {
  const tabs = tabsFor();
  document.querySelectorAll('.modemenu button[data-mode]').forEach((b) => { b.hidden = !tabs.includes(b.dataset.mode); });
  document.querySelectorAll('.roleswitch [data-role]').forEach((b) => b.classList.toggle('on', b.dataset.role === S.role));
  document.querySelector('.roleswitch').hidden = S.session === 'guest';
  if (!tabs.includes(S.mode) && !['studio', 'guest'].includes(S.mode)) setMode(tabs[0]);
  else setMode(S.mode === 'landing' ? tabs[0] : S.mode);
}
async function startSession(kind, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  document.getElementById('view').innerHTML = '<div class="loading" aria-live="polite"><div class="skel"></div><p>Loading…</p></div>';
  S.session = kind; saveSession();
  S.role = 'parent';
  try { localStorage.setItem('fa-role', 'parent'); } catch { /* private mode */ }
  if (kind === 'demo') {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { accountId: 'acc-guardian' } });
      S.token = r.token; S.account = r.account;
    } catch { S.token = null; S.account = null; }
  } else {
    S.token = null; S.account = null;
  }
  applyRole();
}
async function bootSession() {
  if (!S.session) { setMode('landing'); return; }
  if (S.session === 'demo' && !S.token) {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { accountId: 'acc-guardian' } });
      S.token = r.token; S.account = r.account;
    } catch { /* offline: views degrade gracefully */ }
  }
  applyRole();
}
function landing() {
  const v = document.getElementById('view');
  v.innerHTML = '<div class="panel landhero"><h2>Folkstyle Arena</h2><p>Tournament day: wrestlers, brackets, mats, and cards.</p></div>'
    + '<div class="panel"><button class="big primary landbtn" id="landemo">Continue as Demo</button>'
    + '<p class="hint">The full demo tournament. Clearly labeled DEMO DATA on every page.</p></div>'
    + '<div class="panel"><button class="big landbtn" id="languest">Continue as Guest</button>'
    + '<p class="hint">Public views and the Bracket Generator only. No saved profile or private notes. Labeled Guest.</p></div>'
    + '<div class="panel"><button class="big landbtn" id="lansign">Sign in</button>'
    + '<p class="hint">Demo session roles for demo purposes only — this repo has no real authentication backend.</p></div>';
  document.getElementById('landemo').onclick = (e) => startSession('demo', e.target);
  document.getElementById('languest').onclick = (e) => startSession('guest', e.target);
  document.getElementById('lansign').onclick = () => signinView();
}
function signinView() {
  const v = document.getElementById('view');
  v.innerHTML = '<div class="panel"><h2>Sign in</h2>'
    + '<p class="held">Demo only: no real authentication backend exists in this repo. These are session roles for demo purposes — not secure accounts.</p>'
    + '<div class="row"><button class="big primary" data-srole="parent">Parent</button>'
    + '<button class="big" data-srole="organizer">Organizer</button>'
    + '<button class="big" data-srole="table">Table Worker</button></div>'
    + '<div class="row"><button class="big" id="backland">Back</button></div></div>';
  v.querySelectorAll('[data-srole]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    S.session = 'authed'; saveSession();
    await setRole(b.dataset.srole);
  });
  document.getElementById('backland').onclick = () => setMode('landing');
}
async function setRole(role) {
  S.role = role;
  try { localStorage.setItem('fa-role', role); } catch { /* private mode */ }
  try {
    const r = await api('/auth/login', { method: 'POST', body: { accountId: ROLE_DEMO_ACCOUNT[role] } });
    S.token = r.token; S.account = r.account;
  } catch { /* offline: keep current session */ }
  applyRole();
}

document.querySelectorAll('.modemenu button[data-mode], #menupanel button[data-mode]').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
document.querySelectorAll('.roleswitch [data-role]').forEach((b) => b.onclick = () => setRole(b.dataset.role));
document.getElementById('menubtn').onclick = () => {
  const p = document.getElementById('menupanel');
  p.hidden = !p.hidden;
  document.getElementById('menubtn').setAttribute('aria-expanded', String(!p.hidden));
};
document.getElementById('aboutbtn').onclick = about;
document.getElementById('aboutbtn2').onclick = about;
document.getElementById('switchsession').onclick = () => {
  S.session = null; saveSession();
  S.token = null; S.account = null; S.role = 'parent';
  try { localStorage.setItem('fa-role', 'parent'); } catch { /* private mode */ }
  setMode('landing');
};
document.getElementById('search').addEventListener('change', async (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById('searchresults');
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<div class="panel"><p>Searching…</p></div>';
  try {
    const r = await api('/search?q=' + encodeURIComponent(q) + (S.tournamentId ? '&tournamentId=' + S.tournamentId : ''));
    const res = r.results || [];
    if (!res.length) { box.innerHTML = '<div class="panel"><p>No matches for “' + esc(q) + '”.</p></div>'; return; }
    box.innerHTML = '<div class="panel"><h3>Results</h3>' + res.map((x, i) =>
      '<button class="srrow" data-sr="' + i + '"><span class="srkind">' + esc(x.kind) + '</span><span>' + esc(x.label) + '</span></button>').join('') + '</div>';
    box.querySelectorAll('[data-sr]').forEach((b) => b.onclick = () => {
      const x = res[Number(b.dataset.sr)];
      box.hidden = true;
      if (x.kind === 'wrestler' && x.id) { S.wrestlerId = x.id; setMode('wrestler'); }
      else if (x.kind === 'bracket' && x.id) { S.afterSpectator = { expand: x.id, match: null }; setMode('spectator'); }
      else if (x.kind === 'bout' && x.bracketId) { S.afterSpectator = { expand: x.bracketId, match: x.id }; setMode('spectator'); }
      else if (x.kind === 'club') { setMode('spectator'); }
      else if (x.kind === 'note') { setMode('notes'); }
    });
  } catch (err) { box.innerHTML = '<div class="panel"><p>' + esc(err.message) + '</p></div>'; }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.getElementById('modal').hidden = true;
  document.getElementById('menupanel').hidden = true;
  document.getElementById('searchresults').hidden = true;
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
bootSession();
