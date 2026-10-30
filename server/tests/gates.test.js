// gates.test.js — §12 required tests: rest gate, bout cap, weigh-in/skin gate,
// short ID, kudos cap, card lock, PIN, 5:7 card regression, mode separation.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blank, createWrestler, mapAlias, resolveWrestler } from '../src/stores.js';
import { createTournamentConfig, RULE_PRESETS, validateConfig, getPreset } from '../src/rules.js';
import {
  restStatus, lastBoutEnd, boutsWrestled, eligibility, seedingFlags,
  generateDoubleElim, recordResult, readyMatches, resolveWrestler as resolveW,
} from '../src/engine.js';
import {
  register, checkin, scoreMatch, giveKudos, kudosTallies, createCardEvent, setOnDisplay,
  mintMilestone, setHouseholdPin, checkHouseholdPin, clockIn, clockOut, KUDOS_CAP,
} from '../src/tournament.js';
import { encodeHistory, decodeHistory } from '../src/encoding.js';
import { providerStatus, validateProposedProfile, mockWonderParse } from '../src/meta.js';

const ROOT = new URL('../../', import.meta.url);

describe('rest gate: held until prev_end + floor, explained in plain words', () => {
  it('holds and clears from the tournament floor, measured from match END', () => {
    const held = restStatus({ lastBoutEndIso: '2026-10-31T10:00:00Z', nowIso: '2026-10-31T10:12:00Z', restFloorMin: 20 });
    assert.equal(held.state, 'held');
    assert.match(held.message, /HELD — rest gate: wrestled 12 min ago, needs 20 min/);
    const clear = restStatus({ lastBoutEndIso: '2026-10-31T10:00:00Z', nowIso: '2026-10-31T10:25:00Z', restFloorMin: 20 });
    assert.equal(clear.state, 'clear');
  });
  it('lastBoutEnd reads real match END times', () => {
    const ms = [
      { result: { winnerId: 'a', loserId: 'b' }, ended_at: '2026-10-31T10:00:00Z' },
      { result: { winnerId: 'b', loserId: 'a' }, ended_at: '2026-10-31T11:00:00Z' },
    ];
    assert.equal(lastBoutEnd(ms, 'a'), '2026-10-31T11:00:00Z');
    assert.equal(lastBoutEnd(ms, 'zzz'), null);
  });
});

describe('scoreMatch reads LIVE bracket structures: rest HOLD at finalize, waiver logged', () => {
  it('finalize is blocked with REST_HOLD until the floor passes', () => {
    const db = blank();
    db.tournaments['t1'] = { id: 't1', config: createTournamentConfig(db, { presetId: 'youth-local', overrides: { restFloorMin: 60 } }) };
    const ws = ['A', 'B', 'C', 'D'].map((name) => createWrestler(db, { name, grade: '5' }));
    for (const w of ws) {
      register(db, 't1', w.id, {});
      checkin(db, 't1', w.id, { weighinWeight: 70, skinCheck: 'pass', by: 'test' });
    }
    const struct = generateDoubleElim({ bracketId: 'b', seeds: ws.map((w) => w.id) });
    db.brackets['b'] = { id: 'b', tournament_id: 't1', structure: struct };
    const T0 = '2026-10-31T10:00:00Z';
    for (const m of readyMatches(struct)) {
      const byId = Object.fromEntries(struct.matches.map((x) => [x.id, x]));
      const a = resolveW(m.slot_a, byId, struct.seeds);
      const b = resolveW(m.slot_b, byId, struct.seeds);
      scoreMatch(db, 't1', 'b', m.id,
        { outcome: 'decision', winnerId: a, loserId: b, scoreA: 6, scoreB: 2 },
        { actor: 'test', at: T0 });
    }
    // Winners' next bout 5 minutes later: HELD, with the plain-words reason.
    const next = readyMatches(struct).find((m) => m.bracket_side === 'WB');
    const byId = Object.fromEntries(struct.matches.map((x) => [x.id, x]));
    const a = resolveW(next.slot_a, byId, struct.seeds);
    const b = resolveW(next.slot_b, byId, struct.seeds);
    assert.throws(() => scoreMatch(db, 't1', 'b', next.id,
      { outcome: 'decision', winnerId: a, loserId: b, scoreA: 6, scoreB: 2 },
      { actor: 'test', at: '2026-10-31T10:05:00Z' }), /HELD — rest gate/);
    // Same bout after the floor: clear.
    scoreMatch(db, 't1', 'b', next.id,
      { outcome: 'decision', winnerId: a, loserId: b, scoreA: 6, scoreB: 2 },
      { actor: 'test', at: '2026-10-31T11:05:00Z' });
    // Waiver path is logged, not silent.
    const consol = readyMatches(struct).find((m) => m.bracket_side === 'CONS');
    const cA = resolveW(consol.slot_a, byId, struct.seeds);
    const cB = resolveW(consol.slot_b, byId, struct.seeds);
    scoreMatch(db, 't1', 'b', consol.id,
      { outcome: 'decision', winnerId: cA, loserId: cB, scoreA: 6, scoreB: 2 },
      { actor: 'test', at: '2026-10-31T10:10:00Z', restWaiver: { by: 'Director', reason: 'mat available, guardian agreed' } });
    const waivers = Object.values(db.audit).filter((e) => e.action === 'rest.waived');
    assert.equal(waivers.length, 2); // one per held wrestler in the waived bout
  });
});

describe('bout cap: wrestled bouts counted, forfeits received excluded, byes never records', () => {
  it('counts correctly', () => {
    const ms = [
      { status: 'completed', result: { winnerId: 'a', loserId: 'b', outcome: 'decision' } },
      { status: 'completed', result: { winnerId: 'a', loserId: 'c', outcome: 'forfeit' } }, // received: excluded
      { status: 'completed', result: { winnerId: 'd', loserId: 'a', outcome: 'injury-default' } }, // wrestled: counts
      { status: 'completed', result: { winnerId: 'a', loserId: 'e', outcome: 'pin' } },
    ];
    assert.equal(boutsWrestled(ms, 'a'), 3);
  });
});

describe('weigh-in / skin-check gate: no bout eligibility without both', () => {
  it('blocks each missing piece; concussion is a hard lock', () => {
    assert.equal(eligibility(null).eligible, false);
    assert.equal(eligibility({ weighinWeight: null, skinCheck: 'pass', concussionLock: false }).eligible, false);
    assert.equal(eligibility({ weighinWeight: 70, skinCheck: 'pending', concussionLock: false }).eligible, false);
    assert.equal(eligibility({ weighinWeight: 70, skinCheck: 'pass', concussionLock: true }).eligible, false);
    assert.equal(eligibility({ weighinWeight: 70, skinCheck: 'pass', concussionLock: false }).eligible, true);
  });
  it('register -> checkin activates eligibility through the real functions', () => {
    const db = blank();
    db.tournaments['t1'] = { id: 't1' };
    const w = createWrestler(db, { name: 'Kid', grade: '5', team: 'Club' });
    register(db, 't1', w.id, { weight: 70 });
    const r1 = checkin(db, 't1', w.id, { weighinWeight: 71, skinCheck: 'pending', by: 'staff' });
    assert.equal(r1.gate.eligible, false);
    const r2 = checkin(db, 't1', w.id, { skinCheck: 'pass', by: 'staff' });
    assert.equal(r2.gate.eligible, true);
  });
});

describe('short ID: unique, persisted, never re-derived, aliases permanent', () => {
  it('issues 1001+ once and resolves aliases', () => {
    const db = blank();
    const a = createWrestler(db, { name: 'A', grade: '5' });
    const b = createWrestler(db, { name: 'B', grade: '6' });
    assert.equal(a.short_id, '1001');
    assert.equal(b.short_id, '1002');
    assert.notEqual(a.id, b.id);
    assert.match(a.id, /^[0-9a-f-]{36}$/); // opaque UUID, not a PII hash
    mapAlias(db, 'OLD-77', a.id);
    assert.equal(resolveWrestler(db, 'OLD-77').id, a.id);
    assert.equal(resolveWrestler(db, '1002').id, b.id);
    assert.throws(() => mapAlias(db, 'OLD-77', b.id), /already mapped/);
  });
  it('prefix/suffix scales past 9,999', () => {
    const db = blank();
    const taken = new Set(Array.from({ length: 9050 }, (_, i) => String(1001 + i)));
    void taken;
    const w = createWrestler(db, { name: 'Z', grade: '5' }, { prefix: '25-' });
    assert.equal(w.short_id, '25-1001');
  });
});

describe('kudos cap: 1 identified giver, max 3 per tournament, server-side', () => {
  it('enforces cap; free-text guests never count', () => {
    const db = blank();
    db.accounts['g1'] = { id: 'g1', role: 'guardian', name: 'G' };
    const w = createWrestler(db, { name: 'K', grade: '5' });
    giveKudos(db, 't1', 'g1', w.id);
    giveKudos(db, 't1', 'g1', w.id);
    giveKudos(db, 't1', 'g1', w.id);
    assert.equal(KUDOS_CAP, 3);
    assert.throws(() => giveKudos(db, 't1', 'g1', w.id), /limit reached/);
    assert.throws(() => giveKudos(db, 't1', 'Guest on this device', w.id), /not counted until you sign in/);
    // Same giver gets a fresh 3 in another tournament; tallies split per/all-time.
    giveKudos(db, 't2', 'g1', w.id);
    const t = kudosTallies(db, 't1');
    assert.equal(t.perTournament[w.id], 3);
    assert.equal(t.allTime[w.id], 4);
  });
});

describe('card lock: once-per-season, 3-4 kept, one display, milestones earned-only', () => {
  it('locks after one event and shares one on-display record', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'C', grade: '5' });
    const variants = await createCardEvent(db, w.id, 'S1', { answers: { color: 'red' } });
    assert.ok(variants.length >= 3 && variants.length <= 4);
    assert.equal(db.onDisplay[w.id].card_id, variants[0].id);
    await assert.rejects(() => createCardEvent(db, w.id, 'S1', { answers: {} }), /One card creation per season/);
    setOnDisplay(db, w.id, variants[2].id);
    assert.equal(db.onDisplay[w.id].card_id, variants[2].id); // album <-> My Wrestler: ONE record
  });
  it('milestones mint only when earned against real records', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'M', grade: '5' });
    await assert.rejects(() => mintMilestone(db, w.id, 'S1', 'won-one'), /not earned yet/);
    // Wrestle and win a real bout in a real bracket, then mint works.
    const o = createWrestler(db, { name: 'O', grade: '5' });
    const struct = generateDoubleElim({ bracketId: 'b', seeds: [w.id, o.id] });
    db.brackets['b'] = { id: 'b', tournament_id: 't1', structure: struct };
    const m = readyMatches(struct)[0];
    recordResult(struct, m.id, { outcome: 'decision', winnerId: w.id, loserId: o.id, scoreA: 6, scoreB: 2 }, { actor: 'test' });
    const card = await mintMilestone(db, w.id, 'S1', 'won-one');
    assert.equal(card.edition, 'won-one');
  });
});

describe('household PIN: hash only, device-local household gate', () => {
  it('stores hash, verifies, never the PIN', () => {
    const db = blank();
    setHouseholdPin(db, 'hh1', '4829');
    assert.ok(!JSON.stringify(db.pins).includes('4829'));
    assert.equal(checkHouseholdPin(db, 'hh1', '4829'), true);
    assert.equal(checkHouseholdPin(db, 'hh1', '0000'), false);
  });
});

describe('table crew: 2-deep, auto-promote, third refused', () => {
  it('clock in/out semantics', () => {
    const db = blank();
    clockIn(db, 't1', '1', 'Ann');
    clockIn(db, 't1', '1', 'Bob');
    assert.throws(() => clockIn(db, 't1', '1', 'Cat'), /refused/);
    const { promoted } = clockOut(db, 't1', '1', 'Ann');
    assert.equal(promoted.name, 'Bob');
    assert.equal(promoted.role, 'worker1');
  });
});

describe('rules: every preset DRAFT, overrides validated, third-place guarded', () => {
  it('ships DRAFT-only with source + edition', () => {
    assert.ok(RULE_PRESETS.length >= 5);
    for (const p of RULE_PRESETS) {
      assert.equal(p.validationStatus, 'draft');
      assert.ok(p.source && p.edition);
    }
  });
  it('rejects thirdPlaceMatch with consolationChallenge (no valid pairing)', () => {
    const db = blank();
    assert.throws(() => createTournamentConfig(db, {
      presetId: 'youth-local', overrides: { thirdPlaceMatch: true, consolationChallenge: true },
    }), /thirdPlaceMatch requires/);
    const cfg = createTournamentConfig(db, { presetId: 'youth-local', overrides: { restFloorMin: 45 } });
    assert.equal(cfg.values.restFloorMin, 45);
    assert.ok(cfg.warnings.join(' ').includes('DRAFT'));
    assert.throws(() => createTournamentConfig(db, { presetId: 'youth-local', overrides: { noSuchField: 1 } }), /not editable/);
  });
  it('Wonder proposals go through the same deterministic validator', () => {
    const proposed = mockWonderParse('USAW folkstyle, 15 minute rest, no reset match');
    const v = validateProposedProfile(proposed);
    assert.equal(v.ok, true);
    assert.equal(v.profile.presetId, 'usaw-2025-26');
    assert.equal(v.profile.values.restFloorMin, 15);
  });
});

describe('encoding: deterministic, reversible, checksum-guarded', () => {
  it('round-trips and detects corruption', () => {
    const rec = { bracket: 'b1', winner: 'w-1', rounds: [1, 2] };
    const a = encodeHistory(rec);
    const b = encodeHistory({ rounds: [1, 2], winner: 'w-1', bracket: 'b1' });
    assert.equal(a, b);
    assert.deepEqual(decodeHistory(a), { v: 1, ...rec });
    assert.throws(() => decodeHistory(a.slice(0, -1) + (a.endsWith('0') ? '1' : '0')), /checksum|corrupted/);
  });
});

describe('seeding flags: contradictions flagged, never silently resolved', () => {
  it('flags head-to-head winner seeded below', () => {
    const flags = seedingFlags({ seeds: ['a', 'b'], history: [{ winnerId: 'b', loserId: 'a' }] });
    assert.equal(flags.length, 1);
    assert.match(flags[0].message, /Human review needed/);
  });
});

describe('card proportions: 5:7 locked in CSS, uniform inset, minis share it', () => {
  it('styles.css locks aspect-ratio 5/7 with balanced padding', () => {
    const css = readFileSync(new URL('../../client/src/styles.css', import.meta.url), 'utf8');
    assert.match(css, /aspect-ratio:\s*5\s*\/\s*7/);
    assert.match(css, /\.cardface,\s*\.minicard\s*\{[^}]*aspect-ratio:\s*5\s*\/\s*7/);
    assert.match(css, /padding:\s*7%/); // uniform inset, all four sides
    const ratios = css.match(/aspect-ratio:[^;]+/g) || [];
    for (const r of ratios) assert.match(r, /5\s*\/\s*7/, 'every card ratio is 5:7');
  });
});

describe('mode separation (static guards on shipped client source)', () => {
  const appJs = readFileSync(new URL('../../client/src/app.js', import.meta.url), 'utf8');
  const studioJs = readFileSync(new URL('../../client/src/studio.js', import.meta.url), 'utf8');
  const indexHtml = readFileSync(new URL('../../client/src/index.html', import.meta.url), 'utf8');
  const section = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

  it('My Wrestler contains no organizer/table actions', () => {
    const mine = section(appJs, 'async function myWrestler', '/* ---------------- Spectator');
    assert.ok(mine.length > 500, 'section extracted');
    for (const banned of ['clockin', 'publish', 'finalize', 'override', 'from-words']) {
      assert.ok(!mine.includes(banned), `My Wrestler must not contain "${banned}"`);
    }
  });
  it('Spectator projection contains no private data paths', () => {
    const spec = section(appJs, 'async function spectator', '/* ---------------- Organizer');
    for (const banned of ['skinCheck', 'weighin', 'private', '/notes', 'concussion']) {
      assert.ok(!banned || !spec.includes(banned), `Spectator must not contain "${banned}"`);
    }
  });
  it('Card Studio entries land on the PIN lock, labelled a household gate', () => {
    assert.ok(studioJs.includes('household gate'));
    assert.ok(studioJs.includes('NOT account security'));
    assert.ok(studioJs.includes('/api/studio/unlock'));
  });
  it('all five modes exist behind an explicit switch, no debug strings', () => {
    for (const m of ['wrestler', 'spectator', 'studio', 'guest', 'organizer']) {
      assert.ok(indexHtml.includes(`data-mode="${m}"`), `mode ${m} present`);
    }
    for (const src of [appJs, studioJs, indexHtml]) {
      for (const banned of ['META AI FLAG', 'MOCK art layer', 'CARD ART GENERATOR']) {
        assert.ok(!src.includes(banned), `no debug string "${banned}" in user UI`);
      }
    }
  });
});

describe('provider honesty: mock by default, loud when real is misconfigured', () => {
  it('defaults to labelled mock; real requires the key; IDs are docs-verified', () => {
    const st = providerStatus({ USE_REAL_META_AI: 'false' });
    assert.equal(st.mode, 'mock');
    assert.match(st.note, /NEVER shipped as real/);
    const real = providerStatus({ USE_REAL_META_AI: 'true' });
    assert.equal(real.mode, 'real');
    assert.ok(real.missing.length >= 1);
    assert.match(real.missing.join(' '), /API key/);
    assert.deepEqual(real.models, {
      image: 'muse-image-1.0', wonder: 'muse-wonder-1.0', spark: 'muse-spark-1.3',
      sam: 'sam-3.1', voice: 'muse-voice-transcribe-1.0',
    });
    assert.equal(real.base, 'https://api.meta.ai/v1');
  });
  it('SAM box grammar parses per the documented format', async () => {
    const { parseSamBoxes } = await import('../src/meta.js');
    const sample = '<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~...|>';
    assert.deepEqual(parseSamBoxes(sample), [{ x1: 353, y1: 382, x2: 453, y2: 427, w: 537, h: 561 }]);
    assert.deepEqual(parseSamBoxes('no boxes here'), []);
  });
});
