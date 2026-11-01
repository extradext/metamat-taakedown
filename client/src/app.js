/* app.js — mode-separated day-of app. No external requests; API only.
   My Wrestler: ONLY selected wrestler, card, up-next, result, warm-up prompt.
   Organizer/Table, Spectator, Guest, About live in their own modes. */
const S = { mode: 'wrestler', role: 'parent', token: null, account: null, wrestlerId: null, tournamentId: null, cache: {} };
try {
  S.tournamentId = localStorage.getItem('fa-tid') || null;
  S.role = localStorage.getItem('fa-role') || 'parent';
  if (!['parent', 'organizer', 'table'].includes(S.role)) S.role = 'parent';
} catch { /* private mode */ }
function curTid() { return S.tournamentId || 'demo-tournament'; }
function saveTid(id) { S.tournamentId = id; try { localStorage.setItem('fa-tid', id); } catch { /* private mode */ } }
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
function matchupHTML(m) {
  if (!m) return '';
  const done = m.status === 'completed';
  const winA = !!(done && m.wid && m.aid && m.wid === m.aid);
  const winB = !!(done && m.wid && m.bid && m.wid === m.bid);
  const sub = done
    ? icon('result') + ' ' + esc(m.outcome || '') + ' · ' + esc(m.scoreA ?? '–') + '–' + esc(m.scoreB ?? '–')
    : m.live ? icon('status') + ' In progress · Bout ' + esc(m.bout ?? '?') + ' · Mat ' + esc(m.mat ?? '—')
    : icon('mat') + ' Bout ' + esc(m.bout ?? '?') + ' · Mat ' + esc(m.mat ?? '—');
  return '<div class="matchup">'
    + '<div class="side' + (winA ? ' winnerglow' : '') + '">' + cardFace({ template: { name: m.a } }, true) + '</div>'
    + '<div class="side' + (winB ? ' winnerglow' : '') + '">' + cardFace({ template: { name: m.b } }, true) + '</div>'
    + '</div><div class="boutmeta">' + sub + '</div>';
}
function cardFace(card, mini = false) {
  if (!card) return '<div class="' + (mini ? 'minicard' : 'cardface') + ' fin-classic"><div class="inset"><div class="nameplate"><span>No card yet</span></div><div class="artwin"></div></div><div class="finish" aria-hidden="true"></div></div>';
  const t = card.template || {};
  return '<div class="' + (mini ? 'minicard' : 'cardface') + ' fin-' + cardTheme(card) + (t.layout === 'full' ? ' fullpic' : '') + '">'
    + '<div class="inset"><div class="nameplate"><span>' + esc(t.name) + '</span><span class="ed">' + esc(card.edition || '') + '</span></div>'
    + '<div class="artwin">' + (card.art ? '<img alt="Card art" src="' + card.art + '">' : '') + '</div>'
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
  const sq2 = nx.current ? '<div class="square now"><span class="k">NEXT BOUT</span><span class="v">NOW · ' + esc(nx.bout_number ?? '') + '</span></div>'
    : nx.bout_number != null ? '<div class="square"><span class="k">NEXT BOUT</span><span class="v">' + esc(nx.bout_number) + '</span></div>'
      : '<div class="square"><span class="k">NEXT BOUT</span><span class="v">—</span></div>';
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
  let bouts = '';
  for (const kid of kids) {
    let s = kid.id === S.wrestlerId ? snap : null;
    if (!s) { try { s = await api('/wrestler/' + kid.id + '/snapshot' + (S.tournamentId ? '?tournamentId=' + S.tournamentId : '')); } catch { continue; } }
    let m = s.next ? findMatch(s.next.bracket_id, s.next.match_id) : null;
    let tag = m ? (s.next.current ? 'NOW' : 'UP NEXT') : null;
    if (!m) { m = lastDone(kid.id); tag = m ? 'LAST BOUT' : null; }
    if (!m) continue;
    bouts += '<div class="panel"><h3>' + esc(tag) + ' · ' + esc(kid.name) + '</h3>' + matchupHTML(m) + '</div>';
  }
  v.innerHTML = '<section aria-label="My Wrestler">'
    + '<div class="panel"><div class="row"><div><h2 style="margin:0">' + avatar(snap.wrestler.name) + ' ' + esc(snap.wrestler.name) + '</h2>'
    + '<div style="color:var(--muted)">Grade ' + esc(snap.wrestler.grade) + '</div>'
    + '<div style="margin-top:6px">' + schoolChip(snap.wrestler.team) + '</div></div>'
    + '<div class="squares"><div class="square"><span class="k">' + icon('mat') + ' MAT</span><span class="v">' + esc(nx.mat ?? '—') + '</span></div>' + sq2 + '</div></div>'
    + (snap.rest && snap.rest.state === 'held' ? '<p class="held">' + icon('rest') + ' ' + esc(snap.rest.message) + '</p>' : '<p class="clear">' + icon('result') + ' Clear to wrestle.</p>')
    + '</div>'
    + '<div class="cardframe">' + cardFace(snap.card) + '</div>'
    + bouts
    + '<div class="split">'
    + ((snap.notes && snap.notes.length) ? '<div class="panel"><h3>Notes</h3><p>' + snap.notes.map((n) => esc(n.body)).join('</p><p>') + '</p></div>' : '')
    + ((snap.coachFeedback && snap.coachFeedback.length) ? '<div class="panel"><h3>From the coach</h3><p>' + snap.coachFeedback.map(esc).join('</p><p>') + '</p></div>' : '')
    + '</div>'
    + '<details class="menu"><summary>More</summary><div class="menubody">'
    + '<div class="panel"><h3>Today</h3><p>' + esc(snap.today || 'No bouts yet today.') + '</p></div>'
    + '<div class="panel"><h3>Warm-up</h3><p>' + esc(pick(WARMUPS)) + '</p>'
    + '<button class="big" id="notew">Add a note for later</button></div>'
    + (mine.length > 1 ? '<div class="panel"><h3>My Wrestlers</h3><div id="conflicts"></div>' + mine.map((w) =>
      '<button class="big" data-w="' + w.id + '">' + esc(w.name) + '</button>').join('') + '</div>' : '')
    + '</div></details>'
    + '<p class="encourage">' + esc(pick(ENCOURAGE)) + '</p>'
    + '</section>';
  if (mine.length > 1 && S.token) {
    try {
      const c = await api('/tournaments/' + (S.tournamentId || 'demo-tournament') + '/conflicts?wrestlerIds=' + mine.map((w) => w.id).join(','));
      const el = document.getElementById('conflicts');
      if (el && c.alerts.length) el.innerHTML = c.alerts.map((a) =>
        '<p class="' + (a.level === 'red' ? 'held' : '') + '">' + esc(a.message) + '</p>').join('');
    } catch { /* conflicts unavailable offline */ }
  }
  document.getElementById('noteW')?.addEventListener('click', () => {});
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
      + '</div><div class="squares"><div class="square"><span class="k">' + icon('mat') + ' MAT</span><span class="v">' + esc(t.mat ?? '—') + '</span></div>' + sq2 + '</div></div>';
  }
  team += '</div>';
  const blist = data.brackets || [];
  if (S.bracketSel == null || !blist.some((b) => b.id === S.bracketSel)) S.bracketSel = blist[0] && blist[0].id;
  let brackets = '<div class="panel"><div class="row"><h2 style="margin:0">Brackets</h2>'
    + '<button class="big" id="brkrefresh" style="margin-left:auto">Refresh</button></div>'
    + '<div class="chipline" id="brkpicks">' + blist.map((b) =>
      '<button class="chip' + (b.id === S.bracketSel ? ' on' : '') + '" data-b="' + b.id + '">' + icon('weight') + ' ' + esc(b.division) + '</button>').join('')
    + '</div><div class="bracket-sheet" id="brkmount"></div></div>';
  const paintBracket = () => {
    const mount = document.getElementById('brkmount');
    if (!mount) return;
    const b = blist.find((x) => x.id === S.bracketSel) || blist[0];
    if (!b || !window.Bracket) { mount.innerHTML = '<p>No brackets published yet.</p>'; return; }
    window.Bracket.renderSheet(mount, {
      title: (data.tournament ? data.tournament + ' — ' : '') + b.division,
      sub: 'Tap Refresh for live results.',
      format: b.format, matches: b.matches,
    });
  };
  let galMode = 'per';
  const galHtml = () => '<div class="row"><button class="big" id="gper">This tournament</button><button class="big" id="gall">All time</button></div><div class="kudosgallery">'
    + (data.kudos || []).map((k) => '<div class="kudoscard">' + cardFace(k.card, true)
      + '<div>' + esc(k.name) + ' · ' + (galMode === 'per' ? k.count : k.allTime) + ' kudos (' + (galMode === 'per' ? 'tournament' : 'all-time') + ')</div>'
      + '<button class="kudosbtn" data-k="' + k.id + '">Give Kudos</button></div>').join('') + '</div>';
  let gal = '<div class="panel"><h2>Sportsmanship Stars</h2><div id="galbody">' + galHtml() + '</div></div>';
  v.innerHTML = team + brackets + '<div class="panel"><h2>Bulletin</h2><p>' + esc((data.bulletin || []).join(' · ') || 'No announcements.') + '</p></div>' + gal;
  v.querySelectorAll('#brkpicks [data-b]').forEach((btn) => btn.onclick = () => {
    S.bracketSel = btn.dataset.b;
    v.querySelectorAll('#brkpicks .chip').forEach((c) => c.classList.toggle('on', c === btn));
    paintBracket();
  });
  const brkrefresh = document.getElementById('brkrefresh');
  if (brkrefresh) brkrefresh.onclick = () => spectator();
  paintBracket();
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
    const pend = q.filter((m) => !(m.live || m.status === 'in-progress'));
    const rows = q.slice(0, 7).map((m) => {
      const held = heldInfo(m);
      const state = (m.live || m.status === 'in-progress')
        ? '<span class="qstate live">' + icon('status') + ' Live</span>'
        : held ? '<span class="qstate heldq">' + icon('rest') + ' Held — ' + esc(held.name) + ' rested ' + held.rested + ' of ' + floorMin + ' min</span>'
        : m === pend[0] ? '<span class="qstate ondeck">On deck</span>'
        : m === pend[1] ? '<span class="qstate">In the hole</span>'
        : '<span class="qstate">Upcoming</span>';
      return '<div class="qrow"><span class="qbout">Bout ' + esc(m.bout ?? '?') + '</span><span class="qwho">' + esc(m.a) + ' v ' + esc(m.b) + '</span>' + state + '</div>';
    }).join('');
    return '<h3>' + icon('mat') + ' Mat ' + esc(mat) + '</h3>' + rows;
  }).join('') + '</div>';
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
    + infoRow('Date', d.date) + infoRow('Starts', d.startTime) + infoRow('Doors', d.doorsTime)
    + infoRow('Rules', info.rules.presetId + ' (' + info.rules.presetStatus + ')')
    + infoRow('Rest between bouts', info.rules.restFloorMin + ' min')
    + infoRow('Bracket format', FORMAT_LABELS[d.defaultFormat] || d.defaultFormat)
    + infoRow('Entry fee', d.fee) + infoRow('Registration', d.regDetails)
    + infoRow('Tables', d.tables) + infoRow('Referees', d.referees) + infoRow('Head referee', d.headRef)
    + infoRow('Check-in times', d.weighins) + infoRow('Contact', d.contact) + infoRow('Notes', d.notes) + '</div>'
    + (d.raffle ? '<div class="banner"><b>Raffle:</b> ' + esc(d.raffle) + '</div>' : '')
    + '<div class="panel"><h2>' + icon('status') + ' Announcements</h2>' + ((info.bulletin || []).map((b) => '<p>' + esc(b) + '</p>').join('') || '<p>No announcements.</p>') + '</div>';
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
      + '<div class="row"><button class="big primary" id="notelogin">Continue as Demo Parent</button></div></div>';
    document.getElementById('notelogin').onclick = async () => {
      try {
        const r = await api('/auth/login', { method: 'POST', body: { accountId: 'acc-guardian' } });
        S.token = r.token; S.account = r.account; notesView();
      } catch (e) { alert(e.message); }
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
  v.innerHTML = html;
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

/* ---------------- Guest Bracket Generator (same engine, same print) ---------------- */
async function guest() {
  const v = document.getElementById('view');
  let gseed = 'entered', glayout = 'compact';
  v.innerHTML = '<div class="panel noprint"><h2>Guest Bracket Generator</h2><p>Free, no account. Same deterministic engine and same print renderer as tournament brackets.</p>'
    + '<label>Print title (tournament name)</label><input id="gtitle" type="text" value="Guest Bracket">'
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
    const title = document.getElementById('gtitle').value.trim() || 'Guest Bracket';
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
  let st = { mode: 'unknown' };
  try { st = await api('/meta/status'); } catch { /* offline */ }
  alert('Provider status: ' + st.flag + ' — ' + st.mode + '. ' + (st.note || '') + ' Models: ' + JSON.stringify(st.models || {}));
}

const ROLE_TABS = {
  parent: ['wrestler', 'spectator', 'tournament', 'notes'],
  organizer: ['organizer', 'spectator', 'tournament', 'notes'],
  table: ['table', 'spectator', 'tournament', 'notes'],
};
const ROLE_DEMO_ACCOUNT = { parent: 'acc-guardian', organizer: 'acc-organizer', table: 'acc-table1' };
function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('.modemenu button[data-mode], #menupanel button[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  document.getElementById('menupanel').hidden = true;
  document.getElementById('menubtn').setAttribute('aria-expanded', 'false');
  ({ wrestler: myWrestler, spectator, tournament, notes: notesView, organizer, table: tableView, guest, studio: () => window.Studio?.open() })[mode]();
}
function applyRole() {
  const tabs = ROLE_TABS[S.role] || ROLE_TABS.parent;
  document.querySelectorAll('.modemenu button[data-mode]').forEach((b) => { b.hidden = !tabs.includes(b.dataset.mode); });
  document.querySelectorAll('.roleswitch [data-role]').forEach((b) => b.classList.toggle('on', b.dataset.role === S.role));
  if (!tabs.includes(S.mode) && !['studio', 'guest'].includes(S.mode)) setMode(tabs[0]);
  else setMode(S.mode);
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
document.getElementById('search').addEventListener('change', async (e) => {
  const q = e.target.value.trim(); if (!q) return;
  try {
    const r = await api('/search?q=' + encodeURIComponent(q) + (S.tournamentId ? '&tournamentId=' + S.tournamentId : ''));
    alert('Matches: ' + r.results.map((x) => x.label).join(' · '));
  } catch (err) { alert(err.message); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
applyRole();
