/* studio.js — Spotlight Card Studio. Creation spotlight, NOT the landing page.
   Opens directly in one tap: no lock screen, no PIN, no cover. Card stays
   stationary; ONE scrollable tray beneath it. Touch-only tilt/zoom/pan on
   the card; page scrolls when touching outside the card. */
window.Studio = (() => {
  const S = () => ({ token: null });

  async function open() {
    const v = document.getElementById('view');
    let album = { cards: [], onDisplay: null };
    try {
      const r = await fetch('/api/studio/album?wrestlerId=demo');
      album = await r.json();
    } catch { /* offline */ }
    const shown = album.cards.find((c) => c.id === album.onDisplay) || album.cards[0];
    const shownName = (shown && shown.template && shown.template.name) || 'Your Wrestler';
    v.innerHTML = '<section class="studio-live" aria-label="Spotlight Card Studio">'
      + '<div class="cardframe"><div id="livecard"></div></div>'
      + '<div class="tray"><div class="trayhead"><span>' + esc(shownName) + '</span><span class="sub">Spotlight Card Studio</span></div>'
      + '<div class="chipline" id="chips"></div>'
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

  const FINISHES = ['classic', 'shiny', 'fire', 'ice', 'lightning'];
  function renderLiveCard(card) {
    const t = (card && card.template) || { name: 'Your Wrestler', moves: ['Snapdown', 'Stand-up', 'Half Nelson'], flavorLine: 'Card flavour — not wrestling ability.' };
    const th = (card && card.template && card.template.theme) || 'classic';
    const fin = FINISHES.indexOf(th) >= 0 ? th : 'classic';
    document.getElementById('livecard').innerHTML = '<div class="cardface fin-' + fin + '"><div class="inset">'
      + '<div class="nameplate"><span>' + esc(t.name) + '</span><span class="ed">' + esc((card && card.edition) || '') + '</span></div>'
      + '<div class="artwin">' + (card && card.art ? '<img alt="Card art" src="' + card.art + '">' : '') + '</div>'
      + '<div class="moves">' + (t.moves || []).map(esc).join('<br>') + '</div>'
      + '<div class="flavor">' + esc(t.flavorLine || '') + '</div></div><div class="finish" aria-hidden="true"></div></div>';
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
      + '<p>Card style</p><div class="chipline" id="finpick">' + FINISHES.map((f) =>
        '<button class="chip' + (f === 'classic' ? ' on' : '') + '" data-fin="' + f + '">' + f[0].toUpperCase() + f.slice(1) + '</button>').join('') + '</div>'
      + '<p class="hint">Palette follows your favorite color.</p>'
      + shuffled.map((s, i) => '<p>' + s.q + '</p><div class="chipline">' + s.a.map((a) =>
        '<button class="chip" data-q="' + i + '">' + a + '</button>').join('') + '</div>').join('')
      + '<div class="row"><button class="big" id="shuffle">Shuffle</button><button class="big primary" id="make">Make my cards</button></div>';
    const picks = {};
    let finPick = 'classic';
    const liveCard = () => document.querySelector('.studio-live .cardface');
    b.querySelectorAll('[data-q]').forEach((c) => c.onclick = () => { picks[c.dataset.q] = c.textContent; c.classList.add('on'); });
    b.querySelectorAll('[data-fin]').forEach((c) => c.onclick = () => {
      finPick = c.dataset.fin;
      b.querySelectorAll('[data-fin]').forEach((x) => x.classList.toggle('on', x === c));
      const live = liveCard();
      if (live) live.className = live.className.replace(/fin-\w+/g, '').replace(/\s+/g, ' ').trim() + ' fin-' + finPick;
    });
    document.getElementById('qcolor').oninput = (e) => {
      const live = liveCard();
      if (live) live.style.setProperty('--card-accent', e.target.value);
    };
    document.getElementById('shuffle').onclick = questionnaire;
    document.getElementById('make').onclick = async () => {
      const answers = { color: document.getElementById('qcolor').value, animal: document.getElementById('qanimal').value, style: finPick, picks };
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
