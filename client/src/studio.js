/* studio.js — Spotlight Card Studio. Creation spotlight, NOT the landing page.
   Household PIN gate on every entry (device-local household gate — NOT account
   security). Card stays stationary; ONE scrollable tray beneath it. Touch-only
   tilt/zoom/pan on the card; page scrolls when touching outside the card. */
window.Studio = (() => {
  let unlockedUntil = 0;
  const S = () => ({ token: null });

  function lockScreen(v, next) {
    v.innerHTML = '<div class="lockbox"><h2>Card Studio is locked</h2>'
      + '<p>This is a household gate on this device — NOT account security, NOT a guarantee a child cannot guess it.</p>'
      + '<label>Household PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="off">'
      + '<button class="big primary" id="unlock">Unlock Studio</button>'
      + '<p><button id="pinreset">Forgot PIN? Reset with your signed-in account</button></p></div>';
    document.getElementById('unlock').onclick = async () => {
      const pin = document.getElementById('pin').value;
      try {
        const r = await fetch('/api/studio/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Wrong PIN');
        unlockedUntil = Date.now() + 15 * 60000;
        next();
      } catch (e) { alert(e.message); }
    };
    document.getElementById('pinreset').onclick = async () => {
      const np = prompt('New PIN (4+ digits) — resets through your signed-in account:');
      if (!np) return;
      await fetch('/api/studio/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: np }) });
      alert('PIN reset. No PIN is ever shown in logs or on screen.');
    };
  }

  async function open() {
    const v = document.getElementById('view');
    if (Date.now() > unlockedUntil) { lockScreen(v, open); return; }
    let album = { cards: [], onDisplay: null };
    try {
      const r = await fetch('/api/studio/album?wrestlerId=demo');
      album = await r.json();
    } catch { /* offline */ }
    // Blur-when-wrestling (OPTIONAL parent setting, default off): when a
    // household kid is on the mat / on deck / in the hole, start blurred.
    try {
      const wid = (album.cards[0] && album.cards[0].wrestler_id) || '';
      const st = await fetch('/api/studio/status?wrestlerIds=' + wid).then((r) => r.json());
      if (st.blurActive) {
        v.innerHTML = '<div class="banner">' + esc(st.reason) + '</div>'
          + '<div class="blurred"><div class="cardframe"><div class="cardface"><div class="inset"></div></div></div></div>'
          + '<div class="lockbox"><p>Card Studio starts blurred while they wrestle (your setting).</p>'
          + '<button class="big primary" id="unlock2">Unlock with household PIN</button>'
          + '<p>Or open for a set time:</p><div class="row">'
          + [5, 10, 15, 30, 60].map((m) => '<button class="big" data-sz="' + m + '">' + m + ' min</button>').join('') + '</div></div>';
        document.getElementById('unlock2').onclick = () => { lockScreen(v, open); };
        v.querySelectorAll('[data-sz]').forEach((b) => b.onclick = async () => {
          const r = await fetch('/api/studio/snooze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: Number(b.dataset.sz) }) });
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Sign in as a guardian to set the timer.'); return; }
          alert(d.label);
          open();
        });
        return;
      }
    } catch { /* status unavailable offline */ }
    const shown = album.cards.find((c) => c.id === album.onDisplay) || album.cards[0];
    v.innerHTML = '<section class="studio-live" aria-label="Spotlight Card Studio">'
      + '<div class="cardframe"><div id="livecard"></div></div>'
      + '<div class="tray"><div class="chipline" id="chips"></div>'
      + '<div class="row"><button class="big primary" id="create">CREATE</button><button class="big" id="addphoto">ADD PHOTO</button></div>'
      + '<div id="traybody"></div>'
      + '<h3>Album</h3><div class="albumgrid" id="album"></div>'
      + '<p>One creation per season keeps 3–4 variants; ONE is on display; milestone editions unlock only when earned.</p></div>'
      + '</section>';
    document.getElementById('livecard').innerHTML = window.__cardFace ? '' : '';
    renderLiveCard(shown);
    enableTilt(document.querySelector('.cardface'));
    document.getElementById('album').innerHTML = album.cards.map((c) =>
      '<button class="chip" data-c="' + c.id + '">' + (c.edition || 'standard') + ' #' + (c.variant_index + 1) + '</button>').join('');
    document.querySelectorAll('#album .chip').forEach((b) => b.onclick = async () => {
      await fetch('/api/studio/display', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: b.dataset.c }) });
      open(); // album + My Wrestler share ONE on-display record
    });
    document.getElementById('create').onclick = () => questionnaire();
    document.getElementById('addphoto').onclick = () => {
      document.getElementById('traybody').innerHTML = '<div class="row"><button class="big" id="up">Upload a photo</button><button class="big" id="take">Take a picture</button></div>'
        + '<p>Guardian consent required. Background cut-out arrives with SAM 3.1 wiring — until then your photo is framed unaltered, never AI-regenerated.</p>';
      document.getElementById('up').onclick = () => photoFlow('upload');
      document.getElementById('take').onclick = () => photoFlow('camera');
    };
  }

  function renderLiveCard(card) {
    const t = (card && card.template) || { name: 'Your Wrestler', moves: ['Snapdown', 'Stand-up', 'Half Nelson'], flavorLine: 'Card flavour — not wrestling ability.' };
    document.getElementById('livecard').innerHTML = '<div class="cardface"><div class="inset">'
      + '<div class="nameplate"><span>' + esc(t.name) + '</span><span></span></div>'
      + '<div class="artwin">' + (card && card.art ? '<img alt="Card art" src="' + card.art + '">' : '') + '</div>'
      + '<div class="moves">' + (t.moves || []).join('<br>') + '</div>'
      + '<div class="flavor">' + esc(t.flavorLine || '') + '</div></div></div>';
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const QSETS = [
    { q: 'Your hero is…', a: ['Friendly', 'Fierce', 'A little scary'] },
    { q: 'Your style is…', a: ['Attack', 'Brick-wall defense', 'Super silly'] },
    { q: 'Energy?', a: ['Fire', 'Ice', 'Lightning'] },
    { q: 'World?', a: ['Arena sky', 'Volcano', 'Deep sea'] },
    { q: 'Finish?', a: ['Foil sparkle', 'Glitter', 'Matte'] },
    { q: 'Buddy?', a: ['Tiger cub', 'Robot', 'Dragon'] },
  ];
  function questionnaire() {
    const b = document.getElementById('traybody');
    const shuffled = [...QSETS].sort(() => Math.random() - 0.5).slice(0, 4);
    b.innerHTML = '<label>Favorite color</label><input id="qcolor" type="text" value="blue">'
      + '<label>Favorite animal</label><input id="qanimal" type="text" value="tiger">'
      + shuffled.map((s, i) => '<p>' + s.q + '</p><div class="chipline">' + s.a.map((a) =>
        '<button class="chip" data-q="' + i + '">' + a + '</button>').join('') + '</div>').join('')
      + '<div class="row"><button class="big" id="shuffle">Shuffle</button><button class="big primary" id="make">Make my cards</button></div>';
    const picks = {};
    b.querySelectorAll('[data-q]').forEach((c) => c.onclick = () => { picks[c.dataset.q] = c.textContent; c.classList.add('on'); });
    document.getElementById('shuffle').onclick = questionnaire;
    document.getElementById('make').onclick = async () => {
      const answers = { color: document.getElementById('qcolor').value, animal: document.getElementById('qanimal').value, style: 'classic', picks };
      const r = await fetch('/api/studio/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Could not create'); return; }
      alert('Created ' + d.variants.length + ' variants — ALL kept in your album, ONE on display.');
      open();
    };
  }

  function photoFlow(mode) {
    document.getElementById('traybody').innerHTML = '<p>' + (mode === 'upload' ? 'Choose a photo file.' : 'Camera capture.') + ' Guardian consent is on file for this demo account.</p>'
      + '<input id="ph" type="file" accept="image/*"><button class="big primary" id="phgo">Use this photo</button>';
    document.getElementById('phgo').onclick = async () => {
      const f = document.getElementById('ph').files[0];
      if (!f) { alert('Pick a photo first.'); return; }
      const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
      const r = await fetch('/api/studio/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo: String(dataUrl).slice(0, 200000) }) });
      const d = await r.json();
      alert(d.message || 'Photo framed.');
      open();
    };
  }

  // Touch-only tilt/zoom/pan. Touching the card captures the gesture and never
  // scrolls the page; touching outside the card scrolls normally. No buttons.
  function enableTilt(el) {
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let tiltX = 0, tiltY = 0, zoom = 1, panX = 0, panY = 0, last = null, lastTap = 0, pinchD = 0;
    const apply = () => {
      el.style.transform = 'perspective(700px) rotateX(' + tiltX + 'deg) rotateY(' + tiltY + 'deg) scale(' + zoom + ') translate(' + panX + 'px,' + panY + 'px)';
      el.style.setProperty('--sheen', (tiltY * 4) + '%');
    };
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
