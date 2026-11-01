// display.test.js — Focused regression tests for display-only projections:
// simple mat numbers, packet day formatting, and sectioned bulletins.
// These never touch the bracket engine, rest gate, or results.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { displayMat, fmtPacketDay, sectionBulletin } from '../src/app.js';

describe('display mats (simple numbers, no 1A/1B)', () => {
  it('maps split surfaces to separate numbered mats', () => {
    assert.equal(displayMat('1A'), 1);
    assert.equal(displayMat('1B'), 2);
    assert.equal(displayMat('2A'), 3);
    assert.equal(displayMat('2B'), 4);
    assert.equal(displayMat('3B'), 6);
  });
  it('passes plain digits through, blanks stay blank', () => {
    assert.equal(displayMat('4'), 4);
    assert.equal(displayMat(null), null);
    assert.equal(displayMat(''), null);
  });
});

describe('packet day (settings date, never today)', () => {
  it('formats an ISO settings date without UTC shift', () => {
    assert.equal(fmtPacketDay('2026-11-07'), 'Sat Nov 7, 2026');
  });
  it('passes non-ISO text through untouched', () => {
    assert.equal(fmtPacketDay('Nov 7'), 'Nov 7');
    assert.equal(fmtPacketDay(''), '');
  });
});

describe('sectioned bulletin (app and packet agree)', () => {
  it('groups [Tag] lines into labeled sections in order', () => {
    const secs = sectionBulletin([
      '[Info] Welcome!',
      '[Parking] North lot only.',
      '[Snacks] Dogs by the door.',
      '[Raffle] 50/50 at finals.',
      '[Alert] Mat 6 starts late.',
    ]);
    assert.deepEqual(secs.map(([s]) => s), ['Alerts', 'Parking', 'Snacks', 'Raffles', 'Info']);
    assert.deepEqual(secs[0][1], ['Mat 6 starts late.']);
  });
  it('files untagged lines by keyword, unknown lines land in Info', () => {
    const secs = Object.fromEntries(sectionBulletin([
      'Hot dogs at the snack bar',
      'Something entirely different',
    ]));
    assert.deepEqual(secs.Snacks, ['Hot dogs at the snack bar']);
    assert.deepEqual(secs.Info, ['Something entirely different']);
  });
});
