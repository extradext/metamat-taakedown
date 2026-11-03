/* studio.js — Spotlight Card Studio (parent sessions only). Creation
   spotlight, NOT the landing page. Opens directly in one tap and follows the
   selected wrestler. Layered card back-to-front: art or photo filling the
   frame, a gradient scrim, then the template nameplate and stats on top —
   the image model never renders text. Card stays stationary; ONE scrollable
   tray beneath it. Touch gestures plus subtle hover tilt on the preview. */
window.Studio = (() => {
  const widOf = () => (window.FA && window.FA.wrestlerId) || 'demo';
  const SEASON = 'S1';
  const USED_MESSAGE = 'Season creation used — next season or a paid change can create a new card';
  const FINISHES = ['classic', 'shiny', 'fire', 'ice', 'lightning'];
  const GEN_STEPS = ['Dreaming up your hero…', 'Painting the arena energy…', 'Adding the foil finish…', 'Framing your card…'];
  // Wrestler silhouette in an action pose, filling the frame. The no-art
  // placeholder: always labeled SAMPLE ART, never an empty shape, no text.
  const SIL = '<svg class="silart" viewBox="0 0 500 360" aria-hidden="true">'
    + '<defs><linearGradient id="silg" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#3a4a5c"/><stop offset="1" stop-color="#141a21"/>'
    + '</linearGradient></defs><rect width="500" height="360" fill="url(#silg)"/>'
    + '<ellipse cx="250" cy="330" rx="170" ry="22" fill="rgba(0,0,0,.35)"/>'
    + '<g stroke="rgba(8,10,14,.94)" stroke-width="34" stroke-linecap="round" fill="none">'
    + '<path d="M258 148 L232 222 L172 288"/><path d="M258 148 L296 210 L352 236"/>'
    + '<path d="M258 158 L184 178 L138 150"/><path d="M258 158 L330 172 L372 140"/></g>'
    + '<g stroke="rgba(216,169,60,.55)" stroke-width="7" stroke-linecap="round" fill="none">'
    + '<path d="M266 148 L240 222 L180 288"/><path d="M266 158 L338 172 L380 140"/></g>'
    + '<circle cx="262" cy="112" r="33" fill="rgba(8,10,14,.94)"/></svg>';

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
    if (c.edition === 'standard' || c.edition === 'demo-regen') return 'Variant ' + ((c.variant_index || 0) + 1);
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
    const locked = serverLock ? !!serverLock.locked
      : cards.some((c) => c.season_id === SEASON && c.edition === 'standard');
    CACHE = { cards, onDisplay: onId, sections, ctx: album.wrestler || null, milestones: album.milestones || [] };
    const shown = (previewId && cards.find((c) => c.id === previewId)) || cards.find((c) => c.id === onId) || cards[0] || null;
    const shownName = (shown && shown.template && shown.template.name) || (CACHE.ctx && CACHE.ctx.name) || 'Your Wrestler';
    const seasText = locked ? 'Season S1: creation used (1 per season).' : 'Season S1: 1 creation available.';
    // Demo-only regeneration: this button exists ONLY in the Demo session —
    // never Parent, Guest, Organizer, or Table Worker — and the server
    // additionally requires the demo flag plus a demo wrestler.
    const isDemo = !!(window.FA && window.FA.session === 'demo');
    v.innerHTML = '<section class="studio-live" aria-label="Spotlight Card Studio">'
      + '<div class="cardframe"><div id="livecard"></div><div id="displaybar"></div></div>'
      + '<div class="tray"><div class="trayhead"><span>' + esc(shownName) + '</span><span class="sub">Spotlight Card Studio</span></div>'
      + '<p class="hint" id="seasline">' + esc(seasText) + '</p>'
      + '<div class="row"><button class="big primary" id="create">CREATE</button><button class="big" id="addphoto">ADD PHOTO</button></div>'
      + '<div id="locknote" class="locknote"' + (locked ? '' : ' hidden') + '>' + esc(USED_MESSAGE) + '</div>'
      + (isDemo
        ? '<div class="row"><button class="big" id="demoregen">Demo: Regenerate (demo only — does not count as a season creation)</button></div><div id="demomsg"></div>'
        : '')
      + '<div id="traybody"></div>'
      + '<h3>Album</h3><div id="album"></div>'
      + '<p>One creation per season keeps 3–4 variants; ONE is on display; milestone editions unlock only when earned.</p></div>'
      + '</section>';
    renderLiveCard(shown, CACHE.ctx);
    enableTilt(document.querySelector('.cardface'));
    renderAlbum();
    paintDisplayBar(shown && shown.id);
    const createBtn = document.getElementById('create');
    if (locked) {
      // Root fix for the season contradiction: at 1 used / 0 remaining the
      // button looks disabled AND says why — and tapping it explains again,
      // never a silent no-op.
      createBtn.classList.add('is-disabled');
      createBtn.setAttribute('aria-disabled', 'true');
      createBtn.onclick = () => {
        const note = document.getElementById('locknote');
        note.hidden = false;
        note.textContent = USED_MESSAGE;
      };
    } else {
      createBtn.onclick = () => questionnaire();
    }
    if (isDemo) document.getElementById('demoregen').onclick = () => demoRegen();
    document.getElementById('addphoto').onclick = () => {
      document.getElementById('traybody').innerHTML = '<div class="row"><button class="big" id="up">Upload a photo</button><button class="big" id="take">Take a picture</button></div>'
        + '<p>Guardian consent required. Background cut-out arrives with SAM 3.1 wiring — until then your photo is framed unaltered, never AI-regenerated.</p>';
      document.getElementById('up').onclick = () => photoFlow('upload');
      document.getElementById('take').onclick = () => photoFlow('camera');
    };
  }

  // Layered spotlight card: art fills the frame, a gradient scrim sits above
  // it, and the template nameplate/stats render on top. One type scale: name
  // largest, weight/division + club next, one hero record line, moves as a
  // small flavour block with the seeding disclaimer. Never a winner glow —
  // glow belongs ONLY on a finalized result, never on a studio preview.
  function renderLiveCard(card, ctx) {
    const t = (card && card.template) || { name: (ctx && ctx.name) || 'Your Wrestler', moves: ['Snapdown', 'Stand-up', 'Half Nelson'], flavorLine: 'Card flavour — not wrestling ability. Never used for seeding, ranking, or matching.' };
    const th = (card && card.template && card.template.theme) || 'classic';
    const fin = FINISHES.indexOf(th) >= 0 ? th : 'classic';
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
    document.getElementById('livecard').innerHTML = '<div class="cardface fin-' + fin + '"><div class="artfill">' + art + '</div>'
      + '<div class="scrim" aria-hidden="true"></div>'
      + '<div class="inset cardlayer">'
      + '<div class="ribbonrow">' + ribbonFor(card) + '</div>'
      + '<div class="nameplate"><span class="cname">' + esc(t.name) + '</span><span class="ed">' + esc(variantName(card)) + '</span></div>'
      + (sub ? '<div class="subline">' + sub + '</div>' : '')
      + '<div class="heroline">' + esc(hero) + '</div>'
      + '<div class="cardpush"></div>'
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
      + (e.bout != null ? 'Bout ' + e.bout : e.round || 'a bout')
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
      : '<p class="empty">No milestones earned yet — win a finalized bout to unlock one.</p>';
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

  // 12 quick questions, about 2 minutes. Everything is one tap.
  const QSETS = [
    { key: 'hero', q: 'Your hero is…', a: ['Friendly', 'Fierce', 'A little scary'] },
    { key: 'style', q: 'Your style is…', a: ['Attack', 'Brick-wall defense', 'Super silly'] },
    { key: 'energy', q: 'Energy?', a: ['Fire', 'Ice', 'Lightning'] },
    { key: 'world', q: 'World?', a: ['Arena sky', 'Volcano', 'Deep sea'] },
    { key: 'finish', q: 'Art vibe?', a: ['Foil sparkle', 'Glitter', 'Matte'] },
    { key: 'buddy', q: 'Buddy?', a: ['Tiger cub', 'Robot', 'Dragon'] },
    { key: 'pose', q: 'Action pose?', a: ['Takedown', 'Victory stand', 'Mat stance'] },
    { key: 'crowd', q: 'Crowd?', a: ['Roaring', 'Friday night', 'Quiet gym'] },
    { key: 'time', q: 'Arena time?', a: ['Day', 'Sunset', 'Night lights'] },
    { key: 'color', q: 'Power color?', a: ['Blue', 'Red', 'Gold'] },
    { key: 'animal', q: 'Animal spirit?', a: ['Tiger', 'Falcon', 'Bear'] },
    { key: 'frame', q: 'Frame edge?', a: ['Gold', 'Silver', 'Bronze'] },
  ];
  function questionnaire() {
    const b = document.getElementById('traybody');
    b.innerHTML = '<h4>Make your card</h4><p class="hint">12 quick questions · about 2 minutes. Tap one answer each — or just hit Make my cards.</p>'
      + '<p class="hint">Card finish</p><div class="chipline" id="finpick">' + FINISHES.map((f) =>
        '<button class="chip' + (f === 'classic' ? ' on' : '') + '" data-fin="' + f + '">' + f[0].toUpperCase() + f.slice(1) + '</button>').join('') + '</div>'
      + QSETS.map((s, i) => '<p>' + esc(s.q) + '</p><div class="chipline">' + s.a.map((a) =>
        '<button class="chip" data-q="' + i + '">' + esc(a) + '</button>').join('') + '</div>').join('')
      + '<div id="makemsg"></div><div class="row"><button class="big primary" id="make">Make my cards</button></div>';
    const picks = {};
    let finPick = 'classic';
    const liveCard = () => document.querySelector('.studio-live .cardface');
    b.querySelectorAll('[data-q]').forEach((c) => c.onclick = () => {
      const i = c.dataset.q;
      picks[i] = c.textContent;
      b.querySelectorAll('[data-q="' + i + '"]').forEach((x) => x.classList.toggle('on', x === c));
    });
    b.querySelectorAll('[data-fin]').forEach((c) => c.onclick = () => {
      finPick = c.dataset.fin;
      b.querySelectorAll('[data-fin]').forEach((x) => x.classList.toggle('on', x === c));
      const live = liveCard();
      if (live) live.className = live.className.replace(/fin-\w+/g, '').replace(/\s+/g, ' ').trim() + ' fin-' + finPick;
    });
    document.getElementById('make').onclick = async (e) => {
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
        const val = (key, fb) => {
          const i = QSETS.findIndex((s) => s.key === key);
          return picks[i] || fb;
        };
        const answers = {
          color: val('color', 'blue'), animal: val('animal', 'tiger'), style: finPick,
          world: val('world', 'arena sky'), finish: val('finish', 'foil sparkle'), picks,
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
  }

  // Demo-only regeneration: runs the live Meta path for a demo wrestler.
  // The server mints a GENERATED card that never counts as the season
  // creation. Failures show the server's exact plain-words reason — a
  // placeholder is never presented as generated.
  async function demoRegen() {
    const msg = document.getElementById('demomsg');
    const btn = document.getElementById('demoregen');
    btn.disabled = true; btn.textContent = 'Regenerating…';
    msg.innerHTML = '';
    try {
      const body = { demo: true, seasonId: 'S1' };
      if (widOf() !== 'demo') body.wrestlerId = widOf();
      const r = await fetch('/api/studio/demo-regenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Regeneration failed');
      const done = '<p class="clear">Demo regenerated — GENERATED card for season ' + esc(d.card.season_id)
        + ', made ' + esc(genDate(d.card.generatedAt)) + '. The season creation count is unchanged.</p>';
      await open();
      const back = document.getElementById('demomsg');
      if (back) back.innerHTML = done;
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Demo: Regenerate (demo only — does not count as a season creation)';
      msg.innerHTML = '<p class="studiomsg held">' + esc(err.message) + '</p>';
    }
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
