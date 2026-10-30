/* app.js — mode-separated day-of app. No external requests; API only.
   My Wrestler: ONLY selected wrestler, card, up-next, result, warm-up prompt.
   Organizer/Table, Spectator, Guest, About live in their own modes. */
const S = { mode: 'wrestler', token: null, account: null, wrestlerId: null, tournamentId: null, cache: {} };

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

function cardFace(card, mini = false) {
  if (!card) return '<div class="' + (mini ? 'minicard' : 'cardface') + '"><div class="inset"><div class="nameplate"><span>No card yet</span></div></div></div>';
  const t = card.template || {};
  return '<div class="' + (mini ? 'minicard' : 'cardface') + (t.layout === 'full' ? ' fullpic' : '') + '">'
    + '<div class="inset"><div class="nameplate"><span>' + esc(t.name) + '</span><span></span></div>'
    + '<div class="artwin">' + (card.art ? '<img alt="Card art" src="' + card.art + '">' : '') + '</div>'
    + '<div class="moves">' + (t.moves || []).map((m) => esc(m)).join('<br>') + '</div>'
    + '<div class="flavor">' + esc(t.flavorLine || '') + '</div></div></div>';
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
        '<button class="big" data-w="' + w.id + '">' + esc(w.name) + ' · ' + esc(w.short_id) + '</button>').join('');
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
  v.innerHTML = '<section aria-label="My Wrestler">'
    + '<div class="panel"><div class="row"><div><h2 style="margin:0">' + esc(snap.wrestler.name) + '</h2>'
    + '<div style="color:var(--muted)">Grade ' + esc(snap.wrestler.grade) + '</div></div>'
    + '<div class="squares"><div class="square"><span class="k">MAT</span><span class="v">' + esc(nx.mat ?? '—') + '</span></div>' + sq2 + '</div></div>'
    + (snap.rest && snap.rest.state === 'held' ? '<p class="held">' + esc(snap.rest.message) + '</p>' : '<p class="clear">Clear to wrestle.</p>')
    + '</div>'
    + '<div class="cardframe">' + cardFace(snap.card) + '</div>'
    + '<div class="panel"><h3>Today</h3><p>' + esc(snap.today || 'No bouts yet today.') + '</p></div>'
    + ((snap.coachFeedback && snap.coachFeedback.length) ? '<div class="panel"><h3>From the coach</h3><p>' + snap.coachFeedback.map(esc).join('</p><p>') + '</p></div>' : '')
    + ((snap.notes && snap.notes.length) ? '<div class="panel"><h3>Notes</h3><p>' + snap.notes.map((n) => esc(n.body)).join('</p><p>') + '</p></div>' : '')
    + '<div class="panel"><h3>Warm-up</h3><p>' + esc(pick(WARMUPS)) + '</p>'
    + '<button class="big" id="notew">Add a note for later</button></div>'
    + '<p class="encourage">' + esc(pick(ENCOURAGE)) + '</p>'
    + (mine.length > 1 ? '<div class="panel"><h3>My Wrestlers</h3><div id="conflicts"></div>' + mine.map((w) =>
      '<button class="big" data-w="' + w.id + '">' + esc(w.name) + '</button>').join('') + '</div>' : '')
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
    team += '<div class="teammate"><div class="who">' + esc(t.name) + (t.held ? '<div class="held">HELD — rest</div>' : '')
      + '</div><div class="squares"><div class="square"><span class="k">MAT</span><span class="v">' + esc(t.mat ?? '—') + '</span></div>' + sq2 + '</div></div>';
  }
  team += '</div>';
  let brackets = '<div class="panel"><h2>Brackets</h2>';
  for (const b of data.brackets || []) {
    brackets += '<div class="bracketcol"><h3>' + esc(b.division) + ' · ' + esc(b.format) + '</h3>';
    for (const m of b.matches.slice(0, 24)) {
      brackets += '<div class="bout">' + esc(m.label) + ' — ' + esc(m.a) + ' vs ' + esc(m.b)
        + (m.result ? ' · <b>' + esc(m.result) + '</b>' : '') + '</div>';
    }
    brackets += '</div>';
  }
  brackets += '</div>';
  let galMode = 'per';
  const galHtml = () => '<div class="row"><button class="big" id="gper">This tournament</button><button class="big" id="gall">All time</button></div><div class="kudosgallery">'
    + (data.kudos || []).map((k) => '<div class="kudoscard">' + cardFace(k.card, true)
      + '<div>' + esc(k.name) + ' · ' + (galMode === 'per' ? k.count : k.allTime) + ' kudos (' + (galMode === 'per' ? 'tournament' : 'all-time') + ')</div>'
      + '<button class="kudosbtn" data-k="' + k.id + '">Give Kudos</button></div>').join('') + '</div>';
  let gal = '<div class="panel"><h2>Sportsmanship Stars</h2><div id="galbody">' + galHtml() + '</div></div>';
  v.innerHTML = team + brackets + '<div class="panel"><h2>Bulletin</h2><p>' + esc((data.bulletin || []).join(' · ') || 'No announcements.') + '</p></div>' + gal;
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
  v.innerHTML = '<div class="panel"><h2>Organizer / Table</h2><p>Signed in as ' + esc(S.account.name) + ' (' + esc(S.account.role) + ')</p>'
    + '<div class="row"><button class="big primary" id="tnew">New tournament</button>'
    + '<button class="big" id="ttable">Table scoreboard</button>'
    + '<button class="big" id="tpacket">Printable packet</button></div></div><div id="orgbody"></div>';
  document.getElementById('tnew').onclick = async () => {
    const name = prompt('Tournament name:'); if (!name) return;
    const setup = prompt('Describe the setup in plain words (rules, rest, format):', 'Youth folkstyle open, 20 minute rest between bouts, double elimination') || '';
    const body = document.getElementById('orgbody');
    body.innerHTML = '<div class="panel"><p>Reading your setup…</p></div>';
    try {
      const w = await api('/tournaments/from-words', { method: 'POST', body: { name, text: setup } });
      body.innerHTML = '<div class="panel"><h3>Validated rule profile</h3><p>Preset: ' + esc(w.profile.presetId) + '</p>'
        + '<pre>' + esc(JSON.stringify(w.profile.overrides, null, 1)) + '</pre>'
        + '<p>' + esc((w.warnings || []).join(' ')) + '</p><p>Provider: ' + esc(w.provider) + '</p>'
        + '<button class="big primary" id="tcreate">Create tournament</button></div>';
      document.getElementById('tcreate').onclick = async () => {
        const t = await api('/tournaments', { method: 'POST', body: { name, presetId: w.profile.presetId, overrides: w.profile.overrides } });
        S.tournamentId = t.tournament.id; alert('Created: ' + t.tournament.id);
      };
    } catch (e) { body.innerHTML = '<div class="panel"><p>' + esc(e.message) + '</p></div>'; }
  };
  document.getElementById('ttable').onclick = () => tableMode();
  document.getElementById('tpacket').onclick = () => { window.open('/api/packet/' + (S.tournamentId || 'demo-tournament'), '_blank'); };
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
    + '<div class="row"><button class="big" id="undo">UNDO</button><button class="big primary" id="final">Finalize</button></div></div>';
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
  document.getElementById('final').onclick = async () => {
    const winner = prompt('Winner: RED or GREEN?', 'RED');
    const outcome = prompt('Outcome (pin/tech-fall/major/decision):', 'decision');
    try {
      await api('/table/finalize', { method: 'POST', body: { tournamentId: tid, bracketId: m.bracket_id, matchId: m.match_id, winner, outcome } });
      alert('Bout finalized.');
    } catch (e) { alert(e.message); }
  };
}

/* ---------------- Guest Bracket Generator (same engine, same print) ---------------- */
async function guest() {
  const v = document.getElementById('view');
  v.innerHTML = '<div class="panel"><h2>Guest Bracket Generator</h2><p>Free, no account. Same deterministic engine and same print renderer as tournament brackets.</p>'
    + '<label>Names (one per line)</label><textarea id="gnames" rows="8">Avery\nBlake\nCasey\nDevon\nEmery\nFinley</textarea>'
    + '<label>Format</label><select id="gfmt"><option value="double-elim">Double elimination</option><option value="round-robin">Round robin</option></select>'
    + '<button class="big primary" id="ggo">Generate</button></div><div id="gout"></div>';
  document.getElementById('ggo').onclick = async () => {
    const names = document.getElementById('gnames').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const out = await api('/guest/bracket', { method: 'POST', body: { names, format: document.getElementById('gfmt').value } });
    document.getElementById('gout').innerHTML = '<div class="panel"><h3>' + esc(out.format) + ' · ' + out.matches.length + ' bouts</h3>'
      + out.matches.map((m) => '<div class="bout">' + esc(m.label) + ' — ' + esc(m.a) + ' vs ' + esc(m.b) + '</div>').join('')
      + '<button class="big" onclick="window.print()">Print</button></div>';
  };
}

/* ---------------- About (organizer/developer honesty panel) ---------------- */
async function about() {
  let st = { mode: 'unknown' };
  try { st = await api('/meta/status'); } catch { /* offline */ }
  alert('Provider status: ' + st.flag + ' — ' + st.mode + '. ' + (st.note || '') + ' Models: ' + JSON.stringify(st.models || {}));
}

function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('.modemenu button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  ({ wrestler: myWrestler, spectator, organizer, guest, studio: () => window.Studio?.open() })[mode]();
}

document.querySelectorAll('.modemenu button').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
document.getElementById('aboutbtn').onclick = about;
document.getElementById('search').addEventListener('change', async (e) => {
  const q = e.target.value.trim(); if (!q) return;
  try {
    const r = await api('/search?q=' + encodeURIComponent(q) + (S.tournamentId ? '&tournamentId=' + S.tournamentId : ''));
    alert('Matches: ' + r.results.map((x) => x.label).join(' · '));
  } catch (err) { alert(err.message); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
setMode('wrestler');
