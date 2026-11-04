/* studio.js — Spotlight Card Studio (parent sessions only). Creation
   spotlight, NOT the landing page. Opens directly in one tap and follows the
   selected wrestler. Template-first card, Pokemon-style: outer foil border,
   nameplate on top, art composited into the art window inside the border,
   stats and moves below — the image model renders art ONLY and never text.
   Card stays stationary; ONE scrollable tray beneath it. Touch gestures plus
   subtle hover tilt on the preview. */
window.Studio = (() => {
  const widOf = () => (window.FA && window.FA.wrestlerId) || 'demo';
  const SEASON = 'S1';
  // Mirrors the server SEASON_LOCK_MESSAGE single source (allowance only).
  const USED_MESSAGE = 'Season creations used (4 of 4) — a new season starts a fresh set';
  // Named card presets (ids must match the server CARD_PRESETS table).
  // Each one is a distinct art-layer prompt set, never a border-colour swap.
  const PRESETS = [
    { id: 'classic', name: 'Classic' },
    { id: 'shiny-glittery', name: 'Shiny Glittery' },
    { id: 'fire', name: 'Fire' },
    { id: 'ice', name: 'Ice' },
    { id: 'lightning', name: 'Lightning' },
    { id: 'attack', name: 'Attack' },
    { id: 'brick-wall', name: 'Brick-Wall Defense' },
    { id: 'super-silly', name: 'Super Silly' },
    { id: 'friendly', name: 'Friendly' },
    { id: 'fierce', name: 'Fierce' },
    { id: 'a-little-scary', name: 'A Little Scary' },
    { id: 'mystery', name: 'Mystery (shuffle)' },
  ];
  const THEME_IDS = PRESETS.map((p) => p.id).filter((id) => id !== 'mystery');
  const GEN_STEPS = ['Dreaming up your hero…', 'Painting the arena energy…', 'Adding the foil finish…', 'Framing your card…'];
  // Wrestler figure in an action pose, filling the frame: filled torso and
  // head with headgear, driving legs, arena light behind. The no-art
  // placeholder: always labeled SAMPLE ART, never an empty shape, no text.
  const SIL = '<svg class="silart" viewBox="0 0 500 360" aria-hidden="true">'
    + '<defs><linearGradient id="silg" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#2c3a58"/><stop offset="1" stop-color="#10151c"/>'
    + '</linearGradient><linearGradient id="silbeam" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="rgba(255,244,214,.28)"/><stop offset="1" stop-color="rgba(255,244,214,0)"/>'
    + '</linearGradient></defs><rect width="500" height="360" fill="url(#silg)"/>'
    + '<polygon points="150,0 205,0 120,360 55,360" fill="url(#silbeam)"/>'
    + '<polygon points="330,0 375,0 430,360 375,360" fill="url(#silbeam)"/>'
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

  // Live cache for immediate preview/display updates (no refetch flash).
  let CACHE = { cards: [], onDisplay: null, sections: null, ctx: null, milestones: [] };

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function genDate(iso) { try { return new Date(iso).toLocaleDateString(); } catch { return String(iso || ''); } }
  function authHeaders() {
    const t = window.FA && window.FA.token;
    return t ? { Authorization: 'Bearer ' + t } : {};
  }
  async function getJSON(url) {
    const r = await fetch(url, { headers: authHeaders() });
    return r.json();
  }
  async function postJSON(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  // Honest source label: GENERATED only for real model art, PHOTO for
  // uploads, SAMPLE ART for anything placeholder. Mock is never GENERATED.
  function sourceOf(c) {
    if (!c || !c.art) return 'SAMPLE ART';
    if (c.edition === 'photo' || c.photoSource) return 'PHOTO';
    if (c.artIsMock) return 'SAMPLE ART';
    return 'GENERATED';
  }
  function variantName(c) {
    if (!c) return 'Card';
    if (c.edition === 'photo') return 'Photo';
    if (c.edition === 'standard' || c.edition === 'demo-regen') {
      const pn = c.template && c.template.presetName;
      return 'Variant ' + ((c.variant_index || 0) + 1) + (pn ? ' · ' + pn : '');
    }
    return String(c.edition || 'Edition');
  }
  function ribbonFor(c) {
    const s = sourceOf(c);
    const cls = s === 'GENERATED' ? 'genribbon' : s === 'PHOTO' ? 'photoribbon' : 'artribbon';
    const when = c && c.generatedAt ? ' · ' + genDate(c.generatedAt) : '';
    return '<div class="' + cls + '">' + s + ' · ' + esc((c && c.season_id) || SEASON) + ' · ' + esc(variantName(c)) + when + '</div>';
  }
  function schoolChip(team) {
    if (!team || team === 'Unattached') return '<span class="sch sch-none">Unattached</span>';
    let h = 0;
    for (const c of team) h = (h * 31 + c.charCodeAt(0)) % 997;
    return '<span class="sch sch' + (h % 6) + '">' + esc(team) + '</span>';
  }
  // School colours drive the card design (nameplate rule, art-window edge,
  // accents) via CSS vars — never just a small text chip.
  function schoolHue(team) {
    if (!team || team === 'Unattached') return null;
    let h = 0;
    for (const c of team) h = (h * 31 + c.charCodeAt(0)) % 997;
    return (h * 137) % 360;
  }
  function schoolStyle(team) {
    const hue = schoolHue(team);
    if (hue == null) return '';
    return ' style="--school:hsl(' + hue + ',72%,58%);--school-deep:hsl(' + hue + ',68%,34%)"';
  }
  // Client-side album grouping fallback (the server sends sections too).
  function groupClient(cards, onDisplayId) {
    const seasons = [...new Set(cards.map((c) => c.season_id))].sort();
    const currentSeason = seasons[seasons.length - 1] || SEASON;
    const onDisplay = cards.find((c) => c.id === onDisplayId) || null;
    const variants = []; const milestones = []; const retired = [];
    for (const c of cards) {
      if (c.retired || c.season_id !== currentSeason) { retired.push(c); continue; }
      if (c.edition === 'standard' || c.edition === 'demo-regen' || c.edition === 'photo') variants.push(c);
      else milestones.push(c);
    }
    return { currentSeason, onDisplay, variants, milestones, retired };
  }

  async function open() {
    const previewId = open._preview || null;
    open._preview = null;
    const v = document.getElementById('view');
    // Parent sessions only. The menu lists Card Studio for parents; guests,
    // table workers, and organizers are turned away here as well.
    const sess = window.FA && window.FA.session;
    const role = window.FA && window.FA.role;
    if (sess === 'guest' || role === 'table' || role === 'organizer') {
      v.innerHTML = '<div class="panel"><h2>Card Studio is for parent sessions</h2>'
        + '<p>Sign in as a parent to make and keep cards.</p></div>';
      return;
    }
    let album = { cards: [], onDisplay: null, sections: null, wrestler: null, milestones: [], lock: null };
    try {
      album = await getJSON('/api/studio/album?wrestlerId=' + encodeURIComponent(widOf()) + '&seasonId=' + SEASON);
    } catch { /* offline */ }
    const cards = album.cards || [];
    const onId = album.onDisplay || null;
    const sections = album.sections || groupClient(cards, onId);
    const serverLock = album.lock;
    const usedCount = serverLock ? serverLock.used
      : new Set(cards.filter((c) => c.season_id === SEASON && c.edition === 'standard').map((c) => c.creation || 1)).size;
    const locked = serverLock ? !!serverLock.locked : usedCount >= 4;
    const remaining = serverLock ? serverLock.remaining : Math.max(0, 4 - usedCount);
    const lockMsg = (serverLock && serverLock.message) || USED_MESSAGE;
    CACHE = { cards, onDisplay: onId, sections, ctx: album.wrestler || null, milestones: album.milestones || [] };
    const shown = (previewId && cards.find((c) => c.id === previewId)) || cards.find((c) => c.id === onId) || cards[0] || null;
    const shownName = (shown && shown.template && shown.template.name) || (CACHE.ctx && CACHE.ctx.name) || 'Your Wrestler';
    const seasText = locked ? 'Season S1: 4 of 4 creations used.' : 'Season S1: ' + usedCount + ' of 4 creations used — ' + remaining + ' left.';
    // Demo-only regeneration: this button exists ONLY in the Demo session —
    // never Parent, Guest, Organizer, or Table Worker — and the server
    // additionally requires the demo flag plus a demo wrestler. One season
    // allows exactly one regeneration: when variants are already kept, the
    // button shows them instead of offering a re-roll.
    const isDemo = !!(window.FA && window.FA.session === 'demo');
    const regenKept = cards.filter((c) => c.season_id === SEASON && c.edition === 'demo-regen');
    const regenArea = !isDemo ? '' : regenKept.length
      ? '<div class="row"><button class="big" id="demoshow">Demo variants kept (' + regenKept.length + ') — show them</button></div><div id="demomsg"></div>'
      : '<div class="row"><button class="big" id="demoregen">Demo: Regenerate (demo only — does not count as a season creation)</button></div><div id="demomsg"></div>';
    v.innerHTML = '<section class="studio-live" aria-label="Spotlight Card Studio">'
      + '<div class="cardframe"><div id="livecard"></div><div id="displaybar"></div></div>'
      + '<div class="tray"><div class="trayhead"><span>' + esc(shownName) + '</span><span class="sub">Spotlight Card Studio</span></div>'
      + '<p class="hint" id="seasline">' + esc(seasText) + '</p>'
      + '<div class="row"><button class="big primary" id="create">CREATE</button><button class="big" id="addphoto">ADD PHOTO</button></div>'
      + '<div id="locknote" class="locknote"' + (locked ? '' : ' hidden') + '>' + esc(lockMsg) + '</div>'
      + regenArea
      + '<div id="traybody"></div>'
      + '<h3>Album</h3><div id="album"></div>'
      + '<p>Four creations per season keep 3–4 variants each; ONE is on display; milestone editions unlock only when earned.</p></div>'
      + '</section>';
    renderLiveCard(shown, CACHE.ctx);
    enableTilt(document.querySelector('.cardface'));
    renderAlbum();
    paintDisplayBar(shown && shown.id);
    const createBtn = document.getElementById('create');
    if (locked) {
      // At 4 used / 0 remaining the button looks disabled AND says why —
      // and tapping it explains again, never a silent no-op.
      createBtn.classList.add('is-disabled');
      createBtn.setAttribute('aria-disabled', 'true');
      createBtn.onclick = () => {
        const note = document.getElementById('locknote');
        note.hidden = false;
        note.textContent = lockMsg;
      };
    } else {
      createBtn.onclick = () => questionnaire();
    }
    if (isDemo) {
      const dg = document.getElementById('demoregen');
      if (dg) dg.onclick = () => demoRegen();
      const ds = document.getElementById('demoshow');
      if (ds) ds.onclick = () => regenStrip(regenKept, 'Already regenerated this season — no re-rolls. Your kept variants:');
    }
    document.getElementById('addphoto').onclick = () => {
      document.getElementById('traybody').innerHTML = '<div class="row"><button class="big" id="up">Upload a photo</button><button class="big" id="take">Take a picture</button></div>'
        + '<p>Guardian consent required. Background cut-out arrives with SAM 3.1 wiring — until then your photo is framed unaltered, never AI-regenerated.</p>';
      document.getElementById('up').onclick = () => photoFlow('upload');
      document.getElementById('take').onclick = () => photoFlow('camera');
    };
  }

  // Template-first spotlight card, Pokemon-style: outer foil border, ribbon
  // and nameplate on top, art composited INTO the art window inside the
  // border (never floating on top), stats and moves below. One type scale:
  // name largest, weight/division + club next, one hero record line, moves
  // as a small flavour block with the seeding disclaimer. School colours
  // drive the design via CSS vars. Never a winner glow — glow belongs ONLY
  // on a finalized result, never on a studio preview.
  function renderLiveCard(card, ctx) {
    const t = (card && card.template) || { name: (ctx && ctx.name) || 'Your Wrestler', moves: ['Snapdown', 'Stand-up', 'Half Nelson'], flavorLine: 'Card flavour — not wrestling ability. Never used for seeding, ranking, or matching.' };
    const th = (card && card.template && card.template.theme) || 'classic';
    const fin = THEME_IDS.indexOf(th) >= 0 ? th : 'classic';
    const art = card && card.art ? '<img alt="Card art" src="' + card.art + '">' : SIL;
    const subBits = [];
    if (ctx && ctx.weight != null) subBits.push(esc(ctx.weight) + ' lb');
    if (ctx && ctx.division) subBits.push(esc(ctx.division));
    const sub = subBits.join(' · ') + (subBits.length && ctx && ctx.team ? ' · ' : '') + (ctx && ctx.team ? schoolChip(ctx.team) : '');
    const rec = ctx && ctx.record;
    const hero = rec && (rec.wins + rec.losses) > 0
      ? 'Record ' + rec.wins + '–' + rec.losses
      : 'Debut season';
    let flavor = t.flavorLine || '';
    if (!/seeding/i.test(flavor)) flavor += (flavor ? ' ' : '') + 'Never used for seeding, ranking, or matching.';
    document.getElementById('livecard').innerHTML = '<div class="cardface fin-' + fin + '"' + schoolStyle(ctx && ctx.team) + '>'
      + '<div class="inset">'
      + '<div class="ribbonrow">' + ribbonFor(card) + '</div>'
      + '<div class="nameplate"><span class="cname">' + esc(t.name) + '</span><span class="ed">' + esc(variantName(card)) + '</span></div>'
      + '<div class="artwin">' + art + '</div>'
      + (sub ? '<div class="subline">' + sub + '</div>' : '')
      + '<div class="heroline">' + esc(hero) + '</div>'
      + '<div class="moves">' + (t.moves || []).map(esc).join('<br>') + '</div>'
      + '<div class="flavor">' + esc(flavor) + '</div></div><div class="finish" aria-hidden="true"></div></div>';
  }

  function cardChip(c, on) {
    return '<button class="chip alb' + (on ? ' on gold-on' : '') + '" data-c="' + c.id + '" aria-pressed="' + !!on + '" aria-label="'
      + esc(c.season_id) + ', ' + esc(variantName(c)) + ', ' + sourceOf(c) + (on ? ', on display' : '') + '">'
      + (c.art ? '<img alt="" src="' + c.art + '">' : '<span class="albsil">' + SIL + '</span>')
      + '<span>' + esc(c.season_id) + ' · ' + esc(variantName(c)) + ' · ' + sourceOf(c) + (on ? ' · On display' : '') + '</span></button>';
  }
  function viaText(via) {
    return (via || []).map((e) => (e.won ? 'Won ' : 'Wrestled ')
      + (e.bout != null ? 'Match ' + e.bout : e.round || 'a match')
      + (e.mat ? ' · Mat ' + e.mat : '')
      + ' · ' + (e.outcome || '')
      + (e.scoreA != null ? ' ' + e.scoreA + '–' + e.scoreB : '')).join('; ');
  }
  // All four album sections always render, even when empty.
  function renderAlbum() {
    const el = document.getElementById('album');
    if (!el) return;
    const secs = CACHE.sections || groupClient(CACHE.cards, CACHE.onDisplay);
    const onHtml = secs.onDisplay ? cardChip(secs.onDisplay, true)
      : '<p class="empty">No card on display yet.</p>';
    const varHtml = secs.variants.length ? secs.variants.map((c) => cardChip(c, c.id === CACHE.onDisplay)).join('')
      : '<p class="empty">No season variants yet — CREATE or ADD PHOTO to start this season.</p>';
    const earned = CACHE.milestones.filter((m) => m.earned);
    let msHtml = earned.length
      ? earned.map((m) => '<div class="milerow"><div><b>' + esc(m.milestone) + '</b>'
        + '<div class="hint">' + esc(viaText(m.via) || 'Finalized result') + '</div></div>'
        + (m.cardId ? '<span class="pill p-done">Minted</span>'
          : '<button class="big" data-claim="' + esc(m.milestone) + '">Claim</button>') + '</div>').join('')
      : '<p class="empty">No milestones earned yet — win a finalized match to unlock one.</p>';
    if (secs.milestones.length) msHtml += '<div class="chipline">' + secs.milestones.map((c) => cardChip(c, c.id === CACHE.onDisplay)).join('') + '</div>';
    const retHtml = secs.retired.length ? secs.retired.map((c) => cardChip(c, c.id === CACHE.onDisplay)).join('')
      : '<p class="empty">No retired cards yet — older seasons land here.</p>';
    el.innerHTML = '<section class="albumsec" aria-label="On display"><h4>On display</h4>' + onHtml + '</section>'
      + '<section class="albumsec" aria-label="Season variants"><h4>Season variants</h4><div class="albumgrid">' + varHtml + '</div></section>'
      + '<section class="albumsec" aria-label="Milestone editions"><h4>Milestone editions</h4>' + msHtml + '</section>'
      + '<section class="albumsec" aria-label="Retired cards"><h4>Retired cards</h4><div class="albumgrid">' + retHtml + '</div></section>';
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => previewCard(b.dataset.c));
    el.querySelectorAll('[data-claim]').forEach((b) => b.onclick = () => claimMilestone(b.dataset.claim, b));
  }

  // Tapping a variant previews it in the spotlight immediately.
  function previewCard(id) {
    const c = CACHE.cards.find((x) => x.id === id);
    if (!c) return;
    renderLiveCard(c, CACHE.ctx);
    enableTilt(document.querySelector('.cardface'));
    paintDisplayBar(id);
  }
  function paintDisplayBar(id) {
    const bar = document.getElementById('displaybar');
    if (!bar) return;
    if (!id) { bar.innerHTML = ''; return; }
    if (id === CACHE.onDisplay) {
      bar.innerHTML = '<p class="gold-on"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7"/></svg> On display</p>';
    } else {
      bar.innerHTML = '<button class="big primary" id="setdisplay">Set as display</button><div id="displaymsg"></div>';
      document.getElementById('setdisplay').onclick = () => setDisplay(id);
    }
  }
  // Set as display confirms immediately with the gold On display state; the
  // server write follows, and a failure rolls the state back with its reason.
  async function setDisplay(id) {
    const prev = CACHE.onDisplay;
    CACHE.onDisplay = id;
    renderAlbum();
    paintDisplayBar(id);
    try {
      await postJSON('/api/studio/display', { cardId: id });
    } catch (err) {
      CACHE.onDisplay = prev;
      renderAlbum();
      paintDisplayBar(id);
      const m = document.getElementById('displaymsg');
      if (m) m.innerHTML = '<p class="studiomsg held">' + esc(err.message) + '</p>';
    }
  }

  // Claiming mints the earned milestone edition and shows it immediately.
  async function claimMilestone(milestone, btn) {
    btn.disabled = true;
    try {
      const wid = widOf() === 'demo' ? (CACHE.ctx && CACHE.ctx.id) : widOf();
      const d = await postJSON('/api/studio/milestone', { wrestlerId: wid, seasonId: SEASON, milestone });
      open._preview = d.card.id;
      await open();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Claim';
      const row = btn.closest('.milerow');
      if (row) {
        let e = row.querySelector('.claimerr');
        if (!e) { e = document.createElement('p'); e.className = 'claimerr studiomsg held'; row.appendChild(e); }
        e.textContent = err.message;
      }
    }
  }

  // Guided tap questions: 2 core questions always (hero vibe, style) plus 4
  // drawn at random from the pool, shuffled every time — never a fixed
  // sequence. 2–3 answers each, everything one tap. Presets span cute to
  // fierce so ages 4 through 9 all find an appealing card.
  const QSETS_CORE = [
    { key: 'hero', q: 'Your hero is…', a: ['Friendly', 'Fierce', 'A little scary'] },
    { key: 'style', q: 'Your style is…', a: ['Attack', 'Brick-wall defense', 'Super silly'] },
  ];
  const QSETS_POOL = [
    { key: 'energy', q: 'Energy?', a: ['Fire', 'Ice', 'Lightning'] },
    { key: 'world', q: 'World?', a: ['Arena sky', 'Volcano', 'Deep sea'] },
    { key: 'finish', q: 'Art vibe?', a: ['Foil sparkle', 'Glitter', 'Matte'] },
    { key: 'buddy', q: 'Buddy?', a: ['Tiger cub', 'Robot', 'Dragon'] },
    { key: 'sky', q: 'Arena sky?', a: ['Day', 'Sunset', 'Night lights'] },
    { key: 'pose', q: 'Action pose?', a: ['Takedown', 'Victory stand', 'Mat stance'] },
    { key: 'crowd', q: 'Crowd?', a: ['Roaring', 'Friday night', 'Quiet gym'] },
    { key: 'color', q: 'Power color?', a: ['Blue', 'Red', 'Gold'] },
    { key: 'animal', q: 'Animal spirit?', a: ['Tiger', 'Falcon', 'Bear'] },
    { key: 'frame', q: 'Frame edge?', a: ['Gold', 'Silver', 'Bronze'] },
  ];
  const QSET_DRAW = 4;
  // Answers that name a preset suggest it: the last mapping tap wins, and an
  // explicit preset tap always overrides until the next mapping tap.
  const SUGGEST = {
    Friendly: 'friendly', Fierce: 'fierce', 'A little scary': 'a-little-scary',
    Attack: 'attack', 'Brick-wall defense': 'brick-wall', 'Super silly': 'super-silly',
    Fire: 'fire', Ice: 'ice', Lightning: 'lightning',
  };
  function shuffleIn(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function questionnaire() {
    const b = document.getElementById('traybody');
    const picks = {};
    let presetPick = 'classic';
    const liveCard = () => document.querySelector('.studio-live .cardface');
    const paintFin = (pid) => {
      const live = liveCard();
      if (!live) return;
      const show = pid === 'mystery' ? THEME_IDS[Math.floor(Math.random() * THEME_IDS.length)] : pid;
      live.className = live.className.replace(/fin-[a-z-]+/g, '').replace(/\s+/g, ' ').trim() + ' fin-' + show;
    };
    const setPreset = (pid) => {
      presetPick = pid;
      b.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x.dataset.preset === pid));
      paintFin(pid);
    };
    const render = () => {
      const sets = shuffleIn([...QSETS_CORE, ...shuffleIn(QSETS_POOL).slice(0, QSET_DRAW)]);
      b.innerHTML = '<h4>Make your card</h4><p class="hint">6 quick questions · about a minute. Tap one answer each — or just hit Make my cards.</p>'
        + '<p class="hint">Card preset</p><div class="chipline" id="presetpick">' + PRESETS.map((p) =>
          '<button class="chip' + (p.id === presetPick ? ' on' : '') + '" data-preset="' + p.id + '">' + esc(p.name) + '</button>').join('') + '</div>'
        + '<p class="hint">Suggestion follows your answers — tap any preset to choose.</p>'
        + sets.map((s) => '<p>' + esc(s.q) + '</p><div class="chipline">' + s.a.map((a) =>
          '<button class="chip' + (picks[s.key] === a ? ' on' : '') + '" data-q="' + s.key + '">' + esc(a) + '</button>').join('') + '</div>').join('')
        + '<div id="makemsg"></div><div class="row"><button class="big" id="qshuffle">Shuffle questions</button><button class="big primary" id="make">Make my cards</button></div>';
      b.querySelectorAll('[data-q]').forEach((c) => c.onclick = () => {
        const k = c.dataset.q;
        picks[k] = c.textContent;
        b.querySelectorAll('[data-q="' + k + '"]').forEach((x) => x.classList.toggle('on', x === c));
        const sug = SUGGEST[c.textContent];
        if (sug) setPreset(sug);
      });
      b.querySelectorAll('[data-preset]').forEach((c) => c.onclick = () => setPreset(c.dataset.preset));
      document.getElementById('qshuffle').onclick = () => render();
      document.getElementById('make').onclick = make;
    };
    const make = async (e) => {
      const btn = e.target;
      const msg = document.getElementById('makemsg');
      btn.disabled = true; btn.textContent = 'Making…';
      let step = 0;
      msg.innerHTML = '<p class="genprog" role="status">Generating your card…</p><p class="genstep" id="genstep">' + GEN_STEPS[0] + '</p>';
      const timer = setInterval(() => {
        step = (step + 1) % GEN_STEPS.length;
        const s = document.getElementById('genstep');
        if (s) s.textContent = GEN_STEPS[step];
      }, 900);
      try {
        const answers = {
          preset: presetPick,
          color: picks.color || 'blue', animal: picks.animal || 'tiger',
          world: picks.world || 'arena sky', finish: picks.finish || 'foil sparkle', picks,
        };
        const body = { answers };
        if (widOf() !== 'demo') body.wrestlerId = widOf();
        const r = await fetch('/api/studio/create', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
        const d = await r.json();
        clearInterval(timer);
        if (!r.ok) throw new Error(d.error || 'Could not create');
        const first = d.variants[0];
        open._preview = first.id;
        await open();
        const back = document.getElementById('traybody');
        if (back) {
          back.innerHTML = '<p class="clear">New card ready — ' + esc(sourceOf(first)) + ' · ' + esc(first.season_id) + ' · ' + esc(variantName(first)) + '.</p>'
            + (first.artIsMock ? '<p class="hint">Sample art in this session — live art labels GENERATED.</p>' : '');
        }
      } catch (err) {
        clearInterval(timer);
        msg.innerHTML = '<p class="studiomsg held">Could not create: ' + esc(err.message) + '</p>'
          + '<div class="row"><button class="big primary" id="retry">Try again</button></div>';
        document.getElementById('retry').onclick = () => questionnaire();
      }
    };
    render();
  }

  // Demo-only regeneration: runs the live Meta path for a demo wrestler and
  // keeps a full GENERATED variant set that never counts as the season
  // creation. One season allows exactly one regeneration — kept variants are
  // shown instead of re-rolling. Failures show the server's exact
  // plain-words reason — a placeholder is never presented as generated.
  async function demoRegen() {
    const msg = document.getElementById('demomsg');
    const btn = document.getElementById('demoregen');
    try {
      const alb = await getJSON('/api/studio/album?wrestlerId=' + encodeURIComponent(widOf()) + '&seasonId=' + SEASON);
      const kept = (alb.cards || []).filter((c) => c.season_id === SEASON && c.edition === 'demo-regen');
      if (kept.length) {
        regenStrip(kept, 'Already regenerated this season — no re-rolls. Your kept variants:');
        return;
      }
    } catch { /* offline: fall through; the server enforces the cap */ }
    btn.disabled = true; btn.textContent = 'Regenerating…';
    msg.innerHTML = '<p class="genprog" role="status">Generating your card…</p><p class="genstep">' + GEN_STEPS[0] + '</p>';
    try {
      const body = { demo: true, seasonId: 'S1', answers: { preset: 'mystery' } };
      if (widOf() !== 'demo') body.wrestlerId = widOf();
      const r = await fetch('/api/studio/demo-regenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Regeneration failed');
      const cards = d.cards && d.cards.length ? d.cards : [d.card];
      open._preview = cards[0].id;
      await open();
      regenStrip(cards, 'Demo regenerated — GENERATED set for season ' + cards[0].season_id
        + ', made ' + genDate(cards[0].generatedAt) + '. All ' + cards.length
        + ' variants kept; ONE stays on display. The season creation count is unchanged.');
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Demo: Regenerate (demo only — does not count as a season creation)';
      msg.innerHTML = '<p class="studiomsg held">' + esc(err.message) + '</p>';
    }
  }
  // Preview-together strip for a kept regen set: every variant visible with
  // its preset name and honest source label; tapping one spotlights it.
  // Nothing is discarded.
  function regenStrip(cards, note) {
    const msg = document.getElementById('demomsg');
    if (!msg) return;
    msg.innerHTML = '<p class="clear">' + esc(note) + '</p>'
      + '<div class="regenstrip">' + cards.map((c) =>
        '<button class="chip regen" data-rc="' + c.id + '">'
        + (c.art ? '<img alt="" src="' + c.art + '">' : '<span class="albsil">' + SIL + '</span>')
        + '<span>' + esc(variantName(c)) + ' · ' + esc(sourceOf(c)) + '</span></button>').join('') + '</div>';
    msg.querySelectorAll('[data-rc]').forEach((x) => x.onclick = () => { open._preview = x.dataset.rc; open(); });
  }

  function photoFlow(mode) {
    document.getElementById('traybody').innerHTML = '<p>' + (mode === 'upload' ? 'Choose a photo file.' : 'Camera capture.') + ' Guardian consent is on file for this demo account.</p>'
      + '<input id="ph" type="file" accept="image/*"><button class="big primary" id="phgo">Use this photo</button><div id="phmsg"></div>';
    document.getElementById('phgo').onclick = async (e) => {
      const f = document.getElementById('ph').files[0];
      const msg = document.getElementById('phmsg');
      if (!f) { msg.innerHTML = '<p class="studiomsg held">Pick a photo first.</p>'; return; }
      e.target.disabled = true;
      msg.innerHTML = '<p class="genprog" role="status">Framing your photo…</p>';
      try {
        const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
        const body = { photo: String(dataUrl).slice(0, 200000), seasonId: SEASON };
        if (widOf() !== 'demo') body.wrestlerId = widOf();
        const d = await postJSON('/api/studio/photo', body);
        open._preview = d.card.id;
        await open();
        const back = document.getElementById('traybody');
        if (back) {
          back.innerHTML = '<p class="clear">Photo framed — PHOTO · ' + esc(d.card.season_id) + ' · Photo.</p>'
            + '<p class="hint">' + esc(d.sam && d.sam.applied
              ? 'Background cut-out applied (SAM 3.1).'
              : (d.message || 'Framed unaltered — cut-out arrives with SAM 3.1 wiring.')) + '</p>';
        }
      } catch (err) {
        e.target.disabled = false;
        msg.innerHTML = '<p class="studiomsg held">' + esc(err.message) + '</p>';
      }
    };
  }

  // Subtle tilt on hover plus touch tilt/zoom/pan. Touching the card captures
  // the gesture and never scrolls the page; touching outside the card scrolls
  // normally. No buttons. Reduced-motion users get a still card.
  function enableTilt(el) {
    const reduceCfg = !!(window.FA && window.FA.settings && window.FA.settings.reduceMotion);
    if (!el || reduceCfg || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let tiltX = 0, tiltY = 0, zoom = 1, panX = 0, panY = 0, last = null, lastTap = 0, pinchD = 0;
    const apply = () => {
      el.style.transform = 'perspective(700px) rotateX(' + tiltX + 'deg) rotateY(' + tiltY + 'deg) scale(' + zoom + ') translate(' + panX + 'px,' + panY + 'px)';
      el.style.setProperty('--sheen', (tiltY * 4) + '%');
    };
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      tiltY = Math.max(-10, Math.min(10, px * 20));
      tiltX = Math.max(-10, Math.min(10, -py * 20));
      apply();
    });
    el.addEventListener('mouseleave', () => { tiltX = 0; tiltY = 0; apply(); });
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 2) pinchD = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      last = e.touches[0];
      const now = Date.now();
      if (now - lastTap < 300) { tiltX = tiltY = 0; zoom = 1; panX = panY = 0; apply(); }
      lastTap = now;
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        zoom = Math.min(3, Math.max(1, zoom * (d / (pinchD || d))));
        pinchD = d;
      } else if (last) {
        const dx = e.touches[0].clientX - last.clientX, dy = e.touches[0].clientY - last.clientY;
        if (zoom > 1.05) { panX += dx / zoom; panY += dy / zoom; }
        else { tiltY = Math.max(-38, Math.min(38, tiltY + dx / 4)); tiltX = Math.max(-38, Math.min(38, tiltX - dy / 4)); }
        last = e.touches[0];
      }
      apply();
    }, { passive: false });
  }

  return { open };
})();
