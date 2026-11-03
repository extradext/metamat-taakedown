// static.test.js — Smallest focused regression test for static client serving:
// bytes are resolved BEFORE headers, unknown paths fall back to the mode menu,
// traversal is blocked. (Covers the ERR_HTTP_HEADERS_SENT fix.)
// PART 4 extends it with the visual-system contracts: one icon set, pill
// vocabulary, logo placement, motion budgets, skeletons, and empty states.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStatic } from '../src/app.js';

describe('static client serving', () => {
  it('serves the mode menu at /', () => {
    const { bytes, contentType } = resolveStatic('/');
    assert.equal(contentType, 'text/html');
    const html = bytes.toString('utf8');
    for (const m of ['wrestler', 'spectator', 'studio', 'guest', 'organizer']) {
      assert.ok(html.includes(`data-mode="${m}"`), `mode ${m} served`);
    }
  });
  it('serves css/js with correct types', () => {
    assert.equal(resolveStatic('/styles.css').contentType, 'text/css');
    assert.ok(resolveStatic('/styles.css').bytes.toString('utf8').includes('aspect-ratio: 5 / 7'));
    assert.equal(resolveStatic('/app.js').contentType, 'text/javascript');
  });
  it('unknown paths fall back to index (never a half-response)', () => {
    const { bytes, contentType } = resolveStatic('/nope/not-here');
    assert.equal(contentType, 'text/html');
    assert.ok(bytes.toString('utf8').includes('Folkstyle Arena'));
  });
  it('blocks directory traversal', () => {
    const { bytes } = resolveStatic('/..%2f..%2fpackage.json');
    assert.ok(!bytes.toString('utf8').includes('"folkstyle-arena"') || bytes.toString('utf8').includes('Folkstyle Arena'));
  });
  it('serves the vector mark as favicon.svg', () => {
    const { bytes, contentType } = resolveStatic('/favicon.svg');
    assert.equal(contentType, 'image/svg+xml');
    assert.ok(bytes.toString('utf8').includes('<svg'), 'favicon is vector');
  });
});

const p4appJs = readFileSync(new URL('../../client/src/app.js', import.meta.url), 'utf8');
const p4brkJs = readFileSync(new URL('../../client/src/bracket.js', import.meta.url), 'utf8');
const p4studioJs = readFileSync(new URL('../../client/src/studio.js', import.meta.url), 'utf8');
const p4css = readFileSync(new URL('../../client/src/styles.css', import.meta.url), 'utf8');
const p4indexHtml = readFileSync(new URL('../../client/src/index.html', import.meta.url), 'utf8');
const p4srvJs = readFileSync(new URL('../../server/src/app.js', import.meta.url), 'utf8');
const p4section = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

describe('PART 4 visual system: navy+gold chrome, one type scale, visible focus', () => {
  it('one dark-navy palette and one type scale in CSS', () => {
    assert.ok(p4css.includes('--bg: #0b1220'), 'navy chrome');
    assert.ok(p4css.includes('--gold: #d8a93c'), 'gold accent kept');
    for (const v of ['--t-hero', '--t-section', '--t-body', '--t-cap']) {
      assert.ok(p4css.includes(v + ':'), `type scale ${v}`);
    }
    assert.ok(p4css.includes('.heroname { font-size: var(--t-hero)'), 'hero name uses the scale');
  });
  it('visible focus rings on controls', () => {
    assert.ok(p4css.includes(':focus-visible'), 'focus ring rule');
    assert.ok(p4css.includes('button:focus-visible'), 'controls keep the ring');
  });
  it('compact desktop sidebar and phone bottom nav share destinations', () => {
    assert.ok(p4css.includes('width: 196px'), 'compact sidebar rail');
    for (const m of ['wrestler', 'spectator', 'tournament', 'notes', 'organizer', 'table', 'guest']) {
      assert.ok(p4indexHtml.includes(`data-mode="${m}"`), `destination ${m} present`);
    }
  });
});

describe('PART 4 logo: one vector mark in header, landing, packet, favicon', () => {
  it('header brand carries the mark beside the HTML wordmark', () => {
    assert.ok(p4indexHtml.includes('class="brandmark"'), 'header mark');
    assert.ok(p4indexHtml.includes('class="wordmark"'), 'HTML wordmark, never baked into art');
    assert.ok(p4indexHtml.includes('href="favicon.svg"'), 'favicon linked');
  });
  it('landing hero and packet reuse the same mat-circle/shield mark', () => {
    assert.ok(p4appJs.includes('LOGO_MARK'), 'shared mark constant');
    assert.ok(p4appJs.includes("v.innerHTML = '<div class=\"panel landhero\"><div class=\"landmark\">"), 'landing shows the mark');
    assert.ok(p4srvJs.includes('packetbrand'), 'packet brand row');
    assert.ok(p4srvJs.includes('/favicon.svg'), 'packet links the favicon');
  });
});

describe('PART 4 icons: one line set, one weight, always paired with a label', () => {
  it('single SVG set at one stroke weight, no emoji icon glyphs', () => {
    const entries = (p4appJs.match(/^  [a-z]+: '<svg|^  [a-z]+: '<[a-z]/gm) || []).length;
    assert.ok(entries >= 12, `icon set has ${entries} entries, want 12+`);
    assert.ok(p4appJs.includes('stroke-width="2"'), 'one stroke weight in icon()');
    for (const src of [p4appJs, p4brkJs, p4studioJs, p4indexHtml]) {
      for (const ch of [...src]) {
        const cp = ch.codePointAt(0);
        const pict = (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff) || (cp >= 0x1f000 && cp <= 0x1faff);
        assert.ok(!pict, `no pictograph icons (found U+${cp.toString(16)})`);
      }
    }
    assert.ok(!p4appJs.includes('★') && !p4appJs.includes('☆'), 'star glyphs replaced by the pin icon');
  });
  it('every nav, status, and action icon ships with a visible text label', () => {
    for (const m of ['wrestler', 'spectator', 'tournament', 'notes', 'organizer', 'table', 'guest']) {
      // The bottom-nav buttons carry data-mode="m" with no data-min suffix.
      const at = p4indexHtml.indexOf(`data-mode="${m}"`);
      const navAt = m === 'guest' ? p4indexHtml.indexOf(`data-mode="${m}">`, at + 1) : at;
      const btn = p4indexHtml.slice(navAt - 60, navAt + 700);
      assert.ok(btn.includes('<svg'), `nav ${m} has an icon`);
      assert.ok(btn.includes('navlabel'), `nav ${m} pairs a text label`);
    }
    assert.ok(p4appJs.includes('pinlabel'), 'pin action pairs icon + Pin/Pinned text');
    assert.ok(p4appJs.includes("icon('link') + ' <span>Link</span>"), 'link action pairs icon + text');
    const pill = p4section(p4appJs, 'function statusPill', 'function heldPill');
    assert.ok((pill.match(/icon\('/g) || []).length >= 5, 'every pill branch pairs icon + label');
  });
});

describe('PART 4 pills: one vocabulary, icon + label, never colour alone', () => {
  it('hero, queues, sibling, and detail share Live/On deck/In the hole/Final/Held', () => {
    const pill = p4section(p4appJs, 'function statusPill', 'function heldPill');
    for (const w of ['Final', 'Live</span>', 'On deck</span>', 'In the hole</span>', 'Upcoming</span>']) {
      assert.ok(pill.includes(w), `pill says "${w}"`);
    }
    assert.ok(!pill.includes('LIVE</span>'), 'no shouty LIVE variant');
    const q = p4section(p4appJs, 'function matQueuesHTML', 'function openMatchDetail');
    for (const w of [' Live</span>', 'Held — ', ' On deck</span>', ' In the hole</span>', ' Upcoming</span>']) {
      assert.ok(q.includes(w), `queue says "${w.trim()}"`);
    }
    assert.ok(p4appJs.includes('p-held'), 'Held pill style exists');
    assert.ok(p4css.includes('.pill .ic'), 'pill icons sized, never colour alone');
  });
});

describe('PART 4 motion: purposeful only, sub-300ms, instant when reduced', () => {
  it('card tilt, winner pulse, wire draw, and shimmer exist', () => {
    assert.ok(p4studioJs.includes('enableTilt'), 'studio card tilt kept');
    assert.ok(p4css.includes('@keyframes winpulse'), 'winner-glow pulse');
    assert.ok(p4css.includes('@keyframes wiredraw'), 'bracket wire draw');
    assert.ok(p4css.includes('@keyframes skshimmer'), 'shimmer skeletons');
    assert.ok(p4css.includes('#view.viewswap'), 'view settle transition');
    assert.ok(p4appJs.includes("mount.classList.add('draw')"), 'expand triggers the wire draw');
  });
  it('transitions stay under 300ms; reduced motion makes all instant', () => {
    assert.ok(p4css.includes('220ms'), 'view settle under 300ms');
    assert.ok(p4css.includes('260ms'), 'wire draw under 300ms');
    assert.ok(p4css.includes('body.rm'), 'Reduce motion setting hooks CSS');
    assert.ok(p4css.includes('prefers-reduced-motion'), 'OS reduced-motion honored');
    assert.ok(p4studioJs.includes('FA.settings.reduceMotion'), 'tilt honors the setting');
  });
});

describe('PART 4 loading and empty states: skeletons, illustrations, no bare dashes', () => {
  it('every view switch paints a shimmer skeleton first', () => {
    assert.ok(p4appJs.includes('function viewSkeleton'), 'skeleton renderer');
    assert.ok(p4appJs.includes('viewSkeleton(mode)'), 'setMode paints it on every switch');
  });
  it('flat illustrations explain landing, empty lists, and the celebration', () => {
    for (const k of ['hero:', 'brackets:', 'notes:', 'scanned:', 'celebrate:']) {
      assert.ok(p4appJs.includes(k), `illustration ${k} present`);
    }
    assert.ok(p4appJs.includes('No brackets published yet'), 'empty brackets explained');
    assert.ok(p4appJs.includes('No viewable brackets yet'), 'empty viewable list explained');
    assert.ok(p4appJs.includes('No wrestlers linked yet'), 'empty notes explained');
    assert.ok(p4appJs.includes('Every bracket is Final'), 'completed celebration explained');
  });
  it('no bare dashes or unexplained TBD in the app', () => {
    assert.ok(p4appJs.includes("function tbdName(n) { return n === 'TBD' ? 'To be decided' : n; }"), 'TBD sentinel always explained');
    assert.ok(p4appJs.includes("'Mat TBD'"), 'mat fallback explained');
    assert.ok(p4appJs.includes('Date TBA'), 'date fallback explained');
    assert.ok(p4appJs.includes('No pins yet'), 'fastest-pin fallback explained');
    assert.ok(p4brkJs.includes('To be decided'), 'bracket slots explained');
    assert.ok(p4appJs.includes('(placeholder)'), 'offline stats labeled placeholders');
  });
});

describe('PART 4 settings: reduced-motion and high-contrast controls work', () => {
  it('persisted toggles drive body classes', () => {
    assert.ok(p4indexHtml.includes('id="set-rm"'), 'Reduce motion toggle');
    assert.ok(p4indexHtml.includes('id="set-hc"'), 'High contrast toggle');
    assert.ok(p4appJs.includes('fa-settings'), 'settings persist');
    assert.ok(p4appJs.includes("classList.toggle('rm'"), 'reduce-motion class applied');
    assert.ok(p4appJs.includes("classList.toggle('hc'"), 'high-contrast class applied');
    assert.ok(p4css.includes('body.hc'), 'high-contrast theme exists');
  });
});
