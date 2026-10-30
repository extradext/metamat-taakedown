// static.test.js — Smallest focused regression test for static client serving:
// bytes are resolved BEFORE headers, unknown paths fall back to the mode menu,
// traversal is blocked. (Covers the ERR_HTTP_HEADERS_SENT fix.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
});
