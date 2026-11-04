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
  register, checkin, scoreMatch, tableInput, giveKudos, kudosTallies, createCardEvent, setOnDisplay,
  demoRegenerateCard, DEMO_REGEN_EDITION, DEMO_REGEN_LABEL,
  mintMilestone, earnedMilestones, milestoneEarnings, isFinalizedResult,
  seasonCreationState, SEASON_LOCK_MESSAGE, SEASON_CREATION_LIMIT, albumSections, savePhotoCard,
  setHouseholdPin, checkHouseholdPin, clockIn, clockOut, tableLog, KUDOS_CAP,
  createInvite, acceptInvite, revokeInvite, findInvite,
  tournamentStats, ownsTournament, nextBoutFor, isLiveBout,
} from '../src/tournament.js';
import { buildDemo } from '../src/seed.js';
import { logoutToken, normalizeBulletin as normBullSrv, clearsAfterLabel, parseBoutQuery, bracketShortLink, qrSvg, createApp } from '../src/app.js';
import { encodeHistory, decodeHistory } from '../src/encoding.js';
import { providerStatus, validateProposedProfile, mockWonderParse, describeMetaFailure, metaUrl, MetaCardArtProvider, CARD_PRESETS, CARD_PRESET_IDS, pickPreset, buildArtPrompt, VARIANT_WORDS } from '../src/meta.js';

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

describe('card lock: four generations per season, 3-4 kept each, one display, milestones earned-only', () => {
  it('locks after four events and shares one on-display record', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'C', grade: '5' });
    assert.equal(SEASON_CREATION_LIMIT, 4);
    const sets = [];
    for (let n = 1; n <= 4; n++) {
      const variants = await createCardEvent(db, w.id, 'S1', { answers: { color: 'red' } });
      assert.ok(variants.length >= 3 && variants.length <= 4);
      assert.ok(variants.every((v) => v.creation === n), `set ${n} stamped creation ${n}`);
      sets.push(variants);
    }
    assert.equal(db.onDisplay[w.id].card_id, sets[3][0].id, 'display follows the latest creation');
    await assert.rejects(() => createCardEvent(db, w.id, 'S1', { answers: {} }), /Season creation limit reached/);
    setOnDisplay(db, w.id, sets[0][2].id);
    assert.equal(db.onDisplay[w.id].card_id, sets[0][2].id); // album <-> My Wrestler: ONE record
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

describe('demo regeneration: real lock unchanged, demo-only, never counted', () => {
  const liveStub = (art = 'data:image/png;base64,DEMO') => ({
    isMock: false, label: 'meta:test-image',
    generateArt: async () => ({ art, provider: 'meta:test-image', isMock: false }),
  });

  it('real season lock: 4 creations per season, then CARD_LOCK (Parent and Organizer alike)', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'Real', grade: '5' }); // NOT demo: a real account kid
    assert.equal(w.is_demo, false);
    let perEvent = 0;
    for (let n = 0; n < 4; n++) {
      const variants = await createCardEvent(db, w.id, 'S1', { answers: {}, actor: 'acc-guardian' });
      assert.ok(variants.length >= 3 && variants.length <= 4);
      perEvent = variants.length;
    }
    await assert.rejects(() => createCardEvent(db, w.id, 'S1', { answers: {}, actor: 'acc-organizer' }), /Season creation limit reached/);
    const standards = Object.values(db.cards).filter((c) => c.wrestler_id === w.id && c.season_id === 'S1' && c.edition === 'standard');
    assert.equal(standards.length, 4 * perEvent);
  });

  it('demo regeneration refuses real wrestlers and never touches their locked card', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'Real', grade: '5' });
    const variants = await createCardEvent(db, w.id, 'S1', { answers: {} });
    await assert.rejects(() => demoRegenerateCard(db, w.id, 'S1', { artProvider: liveStub() }), /demo-only/);
    assert.equal(db.onDisplay[w.id].card_id, variants[0].id);
    assert.equal(Object.keys(db.cards).length, variants.length); // nothing added
  });

  it('demo regeneration keeps a full variant set without counting: edition, display, and audit stay clean', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'Demo', grade: '5', isDemo: true });
    const first = await createCardEvent(db, w.id, 'S1', { answers: {} });
    let last = first;
    for (let n = 0; n < 3; n++) last = await createCardEvent(db, w.id, 'S1', { answers: {} });
    await assert.rejects(() => createCardEvent(db, w.id, 'S1', { answers: {} }), /Season creation limit reached/);
    const regens = await demoRegenerateCard(db, w.id, 'S1', { answers: {}, artProvider: liveStub() });
    assert.ok(regens.length >= 3 && regens.length <= 4, 'one regen keeps 3-4 variants');
    for (const regen of regens) {
      assert.equal(regen.edition, DEMO_REGEN_EDITION);
      assert.equal(regen.generatedLabel, DEMO_REGEN_LABEL);
      assert.equal(regen.generatedLabel, 'GENERATED');
      assert.ok(regen.generatedAt);
      assert.equal(regen.season_id, 'S1');
      assert.equal(regen.artIsMock, false);
      assert.ok(CARD_PRESET_IDS.includes(regen.template.theme), 'variant theme is a real preset');
    }
    // Season creation count unchanged: still only the original standard sets.
    const standards = Object.values(db.cards).filter((c) => c.wrestler_id === w.id && c.season_id === 'S1' && c.edition === 'standard');
    assert.equal(standards.length, 4 * first.length);
    // The real season-locked display record is untouched: ONE stays on display.
    assert.equal(db.onDisplay[w.id].card_id, last[0].id);
    // Logged as demo regeneration, never as a season creation.
    const actions = Object.values(db.audit).map((e) => e.action);
    assert.ok(actions.includes('card.demo-regenerated'));
    assert.equal(actions.filter((a) => a === 'card.created').length, 4);
  });

  it('demo regeneration allows no re-rolls: a second call explains instead of minting', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'Demo', grade: '5', isDemo: true });
    const first = await demoRegenerateCard(db, w.id, 'S1', { answers: {}, artProvider: liveStub() });
    await assert.rejects(() => demoRegenerateCard(db, w.id, 'S1', { answers: {}, artProvider: liveStub() }), /already used for this season/);
    const kept = Object.values(db.cards).filter((c) => c.edition === DEMO_REGEN_EDITION);
    assert.equal(kept.length, first.length, 'no extra variants minted');
  });

  it('demo regeneration needs the live Meta path: mock mode is refused loudly, never labeled generated', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'Demo', grade: '5', isDemo: true });
    await assert.rejects(() => demoRegenerateCard(db, w.id, 'S1', { env: { USE_REAL_META_AI: 'false' } }), /Live art is off/);
    assert.equal(Object.keys(db.cards).length, 0);
  });

  it('live failures speak in plain words: key, billing, credits, model error', () => {
    assert.match(describeMetaFailure(new Error('Real Meta calls requested (USE_REAL_META_AI=true) but misconfigured. Missing: META_MODEL_API_KEY')), /missing Meta API key/i);
    assert.match(describeMetaFailure(new Error('Meta Model API /images/generations failed (402): payment required')), /billing/i);
    assert.match(describeMetaFailure(new Error('Meta Model API /images/generations failed (429): quota exceeded')), /credits|limit/i);
    assert.match(describeMetaFailure(new Error('Meta Model API /images/generations failed (404): model not found')), /model/i);
  });

  it('a failing live call saves nothing and keeps the plain-words reason', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'Demo', grade: '5', isDemo: true });
    const failing = { isMock: false, label: 'meta:test', generateArt: async () => { throw new Error('Meta Model API failed (402): card declined'); } };
    await assert.rejects(() => demoRegenerateCard(db, w.id, 'S1', { artProvider: failing }), /billing/i);
    assert.equal(Object.keys(db.cards).length, 0);
  });
});

describe('demo regeneration visibility: Demo mode only (static guards)', () => {
  const studioJs = readFileSync(new URL('../../client/src/studio.js', import.meta.url), 'utf8');
  const appJs = readFileSync(new URL('../../client/src/app.js', import.meta.url), 'utf8');

  it('button carries the plain-words demo-only label', () => {
    assert.ok(studioJs.includes('Demo: Regenerate (demo only — does not count as a season creation)'));
  });
  it('button and live call sit behind the Demo-session gate', () => {
    const gate = studioJs.indexOf("FA.session === 'demo'");
    assert.ok(gate >= 0, 'demo session gate present');
    assert.ok(studioJs.indexOf('demoregen') > gate, 'regen button sits behind the demo gate');
    assert.ok(studioJs.indexOf('/api/studio/demo-regenerate') > gate, 'regen call sits behind the demo gate');
  });
  it('Guest and Table sessions can never open Card Studio', () => {
    assert.ok(!/GUEST_OK = \[[^\]]*studio/s.test(appJs), 'studio absent from guest modes');
    assert.ok(!/TABLE_OK = \[[^\]]*studio/s.test(appJs), 'studio absent from table modes');
  });
});

describe('season lock button state: one source, used count, honest message', () => {
  it('fresh wrestler: 0 used / 4 remaining; counts climb per event; locked at 4 with the button message', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'S', grade: '5' });
    assert.deepEqual(seasonCreationState(db, w.id, 'S1'),
      { used: 0, remaining: 4, locked: false, message: 'Season S1: 4 of 4 creations available.' });
    await createCardEvent(db, w.id, 'S1', { answers: {} });
    assert.deepEqual(seasonCreationState(db, w.id, 'S1'),
      { used: 1, remaining: 3, locked: false, message: 'Season S1: 3 of 4 creations available.' });
    for (let n = 0; n < 3; n++) await createCardEvent(db, w.id, 'S1', { answers: {} });
    assert.deepEqual(seasonCreationState(db, w.id, 'S1'),
      { used: 4, remaining: 0, locked: true, message: SEASON_LOCK_MESSAGE });
    assert.equal(SEASON_LOCK_MESSAGE, 'Season creations used (4 of 4) — a new season starts a fresh set');
  });
  it('photos, demo regens, and milestones never count as the season creation', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'D', grade: '5', isDemo: true });
    savePhotoCard(db, w.id, 'S1', 'data:image/png;base64,XX');
    const liveStub = {
      isMock: false, label: 'meta:t',
      generateArt: async () => ({ art: 'data:x', provider: 'meta:t', isMock: false }),
    };
    await demoRegenerateCard(db, w.id, 'S1', { artProvider: liveStub });
    assert.equal(seasonCreationState(db, w.id, 'S1').locked, false);
  });
  it('CREATE area shows the why and explains on tap instead of a silent no-op (static)', () => {
    const studioJs = readFileSync(new URL('../../client/src/studio.js', import.meta.url), 'utf8');
    assert.ok(studioJs.includes('Season creations used (4 of 4) — a new season starts a fresh set'));
    assert.ok(studioJs.includes('aria-disabled'));
    assert.ok(studioJs.includes('locknote'));
  });
  it('no paid path anywhere: the season allowance is the whole rule (static)', () => {
    const studioJs = readFileSync(new URL('../../client/src/studio.js', import.meta.url), 'utf8');
    const tourJs = readFileSync(new URL('../../server/src/tournament.js', import.meta.url), 'utf8');
    assert.ok(!studioJs.includes('paid'), 'studio has no paid aspect');
    assert.ok(!tourJs.includes('paid'), 'card economy has no paid aspect');
  });
});

describe('milestone gating: finalized results only, listed by earning result', () => {
  const pair = () => {
    const db = blank();
    const w = createWrestler(db, { name: 'W', grade: '5' });
    const o = createWrestler(db, { name: 'O', grade: '5' });
    const struct = generateDoubleElim({ bracketId: 'b', seeds: [w.id, o.id] });
    db.brackets['b'] = { id: 'b', tournament_id: 't1', division: '10U 70-75', structure: struct };
    return { db, w, o, struct };
  };
  it('live input with no result earns nothing', () => {
    const { db, w, struct } = pair();
    const m = readyMatches(struct)[0];
    m.status = 'in-progress';
    m.live_score = { red: 2, green: 0 };
    assert.equal(isFinalizedResult(m), false);
    assert.deepEqual([...earnedMilestones(db, w.id)], []);
    assert.deepEqual(milestoneEarnings(db, w.id).filter((x) => x.earned), []);
  });
  it('completed rows without an end stamp are not finalized', () => {
    const { db, w, o, struct } = pair();
    const m = readyMatches(struct)[0];
    m.status = 'completed';
    m.result = { outcome: 'decision', winnerId: w.id, loserId: o.id, scoreA: 6, scoreB: 2 };
    m.ended_at = null; // no end stamp: not a finalized result
    assert.equal(isFinalizedResult(m), false);
    assert.deepEqual([...earnedMilestones(db, w.id)], []);
  });
  it('finalized wrestled bouts earn: loser wrestled-one, winner wrestled-one + won-one, listed by bout', () => {
    const { db, w, o, struct } = pair();
    const m = readyMatches(struct)[0];
    m.bout_number = 12; m.mat = '2';
    recordResult(struct, m.id, { outcome: 'pin', winnerId: w.id, loserId: o.id, scoreA: 6, scoreB: 0 }, { actor: 'test' });
    assert.equal(isFinalizedResult(m), true);
    assert.deepEqual([...earnedMilestones(db, o.id)], ['wrestled-one']);
    assert.deepEqual([...earnedMilestones(db, w.id)], ['wrestled-one', 'won-one']);
    const won = milestoneEarnings(db, w.id).find((x) => x.milestone === 'won-one');
    assert.equal(won.earned, true);
    assert.equal(won.via[0].bout, 12);
    assert.equal(won.via[0].outcome, 'pin');
  });
  it('finalized admin outcomes are not wrestled bouts', async () => {
    const { db, w, o, struct } = pair();
    const m = readyMatches(struct)[0];
    recordResult(struct, m.id, { outcome: 'forfeit', winnerId: w.id, loserId: o.id }, { actor: 'test' });
    assert.equal(isFinalizedResult(m), true);
    assert.deepEqual([...earnedMilestones(db, w.id)], []);
    await assert.rejects(() => mintMilestone(db, w.id, 'S1', 'won-one'), /not earned yet/);
  });
});

describe('album: four labeled sections, always present even when empty', () => {
  it('groups on-display, variants, milestones, retired (older seasons retire)', async () => {
    const db = blank();
    const w = createWrestler(db, { name: 'A', grade: '5' });
    const s1 = await createCardEvent(db, w.id, 'S1', { answers: {} });
    const s2 = await createCardEvent(db, w.id, 'S2', { answers: {} });
    setOnDisplay(db, w.id, s2[0].id);
    const secs = albumSections(
      Object.values(db.cards).filter((c) => c.wrestler_id === w.id), db.onDisplay[w.id].card_id);
    assert.equal(secs.currentSeason, 'S2');
    assert.equal(secs.onDisplay.id, s2[0].id);
    assert.equal(secs.variants.length, s2.length);
    assert.equal(secs.retired.length, s1.length);
    assert.deepEqual(secs.milestones, []);
  });
  it('studio renders all four sections plus the empty-milestone line (static)', () => {
    const studioJs = readFileSync(new URL('../../client/src/studio.js', import.meta.url), 'utf8');
    for (const s of ['On display', 'Season variants', 'Milestone editions', 'Retired cards']) {
      assert.ok(studioJs.includes(s), `album section "${s}" present`);
    }
    assert.ok(studioJs.includes('No milestones earned yet — win a finalized match to unlock one.'));
    assert.ok(studioJs.includes('6 quick questions'));
    assert.ok(studioJs.includes('Generating your card…'));
    assert.ok(studioJs.includes('Suggestion follows your answers'));
    assert.ok(studioJs.includes('SUGGEST[c.textContent]'), 'mapping taps re-suggest the preset');
    assert.ok(studioJs.includes(`'Brick-wall defense': 'brick-wall'`), 'style answers map to presets');
    assert.ok(studioJs.includes('Set as display'));
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
  it('Card Studio opens directly: no lock screen, PIN gate, cover, or lock option', () => {
    for (const banned of ['lockScreen', 'household gate', 'NOT account security', '/api/studio/unlock',
      'Unlock Studio', 'studio-lock', 'blurActive', 'locktoggle', 'Set PIN', 'Household PIN']) {
      assert.ok(!studioJs.includes(banned), `studio must not contain "${banned}"`);
    }
    assert.ok(studioJs.includes('async function open()'), 'studio has a direct open entry');
    assert.ok(studioJs.includes('studio-live'), 'open renders the studio directly');
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
  it('live image calls hit base + /images/generations (single /v1, never doubled)', async () => {
    assert.equal(metaUrl({}, '/images/generations'), 'https://api.meta.ai/v1/images/generations');
    const seen = {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      seen.url = String(url);
      seen.body = JSON.parse(opts.body);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ url: 'https://cdn.example/art.png' }] }) };
    };
    try {
      const art = new MetaCardArtProvider({ USE_REAL_META_AI: 'true', META_MODEL_API_KEY: 'test-key-only' });
      const out = await art.generateArt({ prompt: 'test prompt, no text' });
      assert.equal(seen.url, 'https://api.meta.ai/v1/images/generations');
      assert.ok(!seen.url.includes('/v1/v1'), 'doubled /v1 path 404s on the live API');
      assert.equal(seen.body.model, 'muse-image-1.0');
      assert.equal(seen.body.prompt, 'test prompt, no text');
      assert.equal(seen.body.n, 1);
      assert.deepEqual(out, { art: 'https://cdn.example/art.png', provider: 'meta:muse-image-1.0', isMock: false });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it('SAM box grammar parses per the documented format', async () => {
    const { parseSamBoxes } = await import('../src/meta.js');
    const sample = '<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~...|>';
    assert.deepEqual(parseSamBoxes(sample), [{ x1: 353, y1: 382, x2: 453, y2: 427, w: 537, h: 561 }]);
    assert.deepEqual(parseSamBoxes('no boxes here'), []);
  });
});

describe('tournament stats: stoppage clocks survive finalize; stats derive read-only', () => {
  it('scoreMatch snapshots final_clocks; stats count pins, blood, minutes, schools', () => {
    const db = blank();
    db.tournaments['t1'] = { id: 't1', config: createTournamentConfig(db, { presetId: 'youth-local', overrides: {} }) };
    const a = createWrestler(db, { name: 'A', grade: '5', team: 'River Club' });
    const b = createWrestler(db, { name: 'B', grade: '5' }); // unattached
    for (const w of [a, b]) {
      register(db, 't1', w.id, {});
      checkin(db, 't1', w.id, { weighinWeight: 70, skinCheck: 'pass', by: 't' });
    }
    const struct = generateDoubleElim({ bracketId: 'br', seeds: [a.id, b.id] });
    struct.matches[0].mat = '1A';
    db.brackets['br'] = { id: 'br', tournament_id: 't1', structure: struct };
    const mid = struct.matches[0].id;
    tableInput(db, 't1', 'br', mid, { clockSec: 95, bloodSec: 30, injurySec: 0 });
    const m = scoreMatch(db, 't1', 'br', mid,
      { outcome: 'pin', winnerId: a.id, loserId: b.id, scoreA: 6, scoreB: 0 }, { actor: 't' });
    assert.deepEqual(m.final_clocks, { clockSec: 95, injurySec: 0, bloodSec: 30 });
    assert.equal(m.result.outcome, 'pin'); // result itself unchanged
    const s = tournamentStats(db, 't1');
    assert.equal(s.matchesWrestled, 1);
    assert.equal(s.pins, 1);
    assert.equal(s.clockSec, 95);
    assert.equal(s.bloodSec, 30);
    assert.equal(s.mats, 1);
    assert.equal(s.schools, 1);
    assert.equal(s.unattached, 1);
    assert.equal(s.wrestlers, 2);
    assert.deepEqual(s.fastestPin, { name: 'A', sec: 95 });
  });
  it('ownership: linked organizers only; legacy open tournaments stay editable', () => {
    assert.equal(ownsTournament({ id: 'o1', role: 'organizer' }, { organizerIds: ['o1'] }), true);
    assert.equal(ownsTournament({ id: 'o2', role: 'organizer' }, { organizerIds: ['o1'] }), false);
    assert.equal(ownsTournament({ id: 'o2', role: 'organizer' }, {}), true);
    assert.equal(ownsTournament({ id: 't1', role: 'table' }, {}), false);
    assert.equal(ownsTournament(null, {}), false);
  });
});

// ---------- PART 2: contradiction fixes (one shared demo dataset) ----------
// Seed names are module-sequenced, so the suite builds ONE demo db up front;
// every PART 2 assertion below is read-only against it.
const P2 = buildDemo(blank());
const p2w = (name) => Object.values(P2.wrestlers).find((w) => w.name === name);
const p2brackets = () => Object.values(P2.brackets).filter((b) => b.tournament_id === 'demo-tournament');
const p2appJs = readFileSync(new URL('../../client/src/app.js', import.meta.url), 'utf8');
const p2section = (start, end) => p2appJs.slice(p2appJs.indexOf(start), p2appJs.indexOf(end, p2appJs.indexOf(start)));

describe('PART 2 (1): next-match truth — a completed bout is never next', () => {
  it('Avery Sutton: Match 5 is Final (Decision 5-3), next is hero Match 7', () => {
    const avery = p2w('Avery Sutton');
    assert.ok(avery, 'demo guardian kid Avery Sutton exists');
    const nx = nextBoutFor(P2, 'demo-tournament', avery.id);
    assert.ok(nx, 'Avery has a next bout');
    assert.equal(nx.bout_number, 7);
    const m5 = P2.brackets['demo-de-bantam'].structure.matches.find((m) => m.bout_number === 5);
    assert.equal(m5.status, 'completed');
    assert.equal(m5.result.outcome, 'decision');
    assert.equal(m5.result.scoreA, 5);
    assert.equal(m5.result.scoreB, 3);
    assert.equal(m5.result.winnerId, avery.id);
    assert.ok(isFinalizedResult(m5));
    assert.notEqual(nx.match_id, m5.id, 'completed Match 5 is never returned as next');
  });
  it('Emery Brooks: next is their own Match 10, never the selected wrestler\'s', () => {
    const emery = p2w('Emery Brooks');
    const avery = p2w('Avery Sutton');
    const e = nextBoutFor(P2, 'demo-tournament', emery.id);
    const a = nextBoutFor(P2, 'demo-tournament', avery.id);
    assert.equal(e.bout_number, 10);
    assert.equal(a.bout_number, 7);
    assert.notEqual(e.match_id, a.match_id);
  });
  it('done wrestlers get null: fully-decided exhibition seeds, unbracketed late entries', () => {
    for (const sid of P2.brackets['demo-de-exhib'].structure.seeds) {
      assert.equal(nextBoutFor(P2, 'demo-tournament', sid), null);
    }
    const seeded = new Set(p2brackets().flatMap((b) => b.structure.seeds));
    const unseeded = Object.values(P2.wrestlers).filter((w) => !seeded.has(w.id));
    assert.equal(unseeded.length, 2, 'two unattached late entries skate outside brackets');
    for (const w of unseeded) assert.equal(nextBoutFor(P2, 'demo-tournament', w.id), null);
  });
  it('current means THAT bout is live: live bouts true, pending and Final false', () => {
    const ms = P2.brackets['demo-de-bantam'].structure.matches;
    const byBout = (n) => ms.find((m) => m.bout_number === n).id;
    assert.equal(isLiveBout(P2, 'demo-de-bantam', byBout(3)), true);
    assert.equal(isLiveBout(P2, 'demo-de-bantam', byBout(4)), true);
    assert.equal(isLiveBout(P2, 'demo-de-bantam', byBout(7)), false);
    assert.equal(isLiveBout(P2, 'demo-de-bantam', byBout(5)), false, 'completed is never current');
    assert.equal(isLiveBout(P2, 'nope', 'nope'), false);
  });
  it('match detail shows the actual next (or Done), never the tapped completed bout (static)', () => {
    const det = p2section('function openMatchDetail', '/* ---------------- Tournament hub');
    assert.ok(det.length > 500, 'section extracted');
    assert.ok(det.includes('nextFor(board, S.wrestlerId)'), 'detail derives the actual next');
    assert.ok(det.includes('Done — no more matches.'), 'detail says Done when none is left');
    assert.ok(!det.includes('yours: m.bout'), 'tapped bout is never labeled Your next');
  });
  it('first paint guards stale snapshots on load, hero, and sibling (static)', () => {
    const mine = p2section('async function myWrestler', '/* ---------------- Spectator');
    assert.ok(mine.includes('if (chk && chk.status === \'completed\') snap.next = null'), 'stale next dropped before paint');
    assert.ok(mine.includes('if (m && m.status === \'completed\') m = null'), 'stale sibling next dropped');
  });
});

describe('PART 2 (2): queue pills match Now — every mat Now is a live bout', () => {
  it('each DE division wrestles live on BOTH sides of its mat pair', () => {
    for (const [id, pair] of [
      ['demo-de-bantam', ['1A', '1B']], ['demo-de-midget', ['2A', '2B']], ['demo-de-junior', ['3A', '3B']],
    ]) {
      const wb1 = P2.brackets[id].structure.matches.filter((m) => m.round_label === 'WB-1');
      assert.equal(wb1.length, 4);
      for (const m of [wb1[2], wb1[3]]) {
        assert.equal(m.status, 'in-progress', `${id} R1 live`);
        assert.ok(m.live_score, `${id} R1 carries live input`);
      }
      assert.deepEqual([wb1[2].mat, wb1[3].mat].sort(), pair, `${id} live bouts split across the pair`);
    }
  });
  it('every mat queue Now (lowest incomplete bout) is live with named wrestlers', () => {
    const brackets = p2brackets();
    const byId = Object.fromEntries(brackets.map((b) => [b.id, Object.fromEntries(b.structure.matches.map((m) => [m.id, m]))]));
    const seedsOf = Object.fromEntries(brackets.map((b) => [b.id, b.structure.seeds]));
    const bidOf = {};
    for (const b of brackets) for (const m of b.structure.matches) bidOf[m.id] = b.id;
    const queue = {};
    for (const b of brackets) for (const m of b.structure.matches) {
      if (m.status !== 'completed' && m.mat != null) (queue[m.mat] = queue[m.mat] || []).push(m);
    }
    assert.deepEqual(Object.keys(queue).sort(), ['1A', '1B', '2A', '2B', '3A', '3B']);
    for (const [mat, q] of Object.entries(queue)) {
      q.sort((x, y) => x.bout_number - y.bout_number);
      const now = q[0];
      assert.ok(now.live_score != null && now.status !== 'completed', `mat ${mat} Now (Match ${now.bout_number}) is live`);
      const bid = bidOf[now.id];
      assert.ok(resolveW(now.slot_a, byId[bid], seedsOf[bid]), `mat ${mat} Now names side A`);
      assert.ok(resolveW(now.slot_b, byId[bid], seedsOf[bid]), `mat ${mat} Now names side B`);
    }
  });
  it('mat queue rows render the live pill for live bouts under a Now header (static)', () => {
    const q = p2section('function matQueuesHTML', 'function openMatchDetail');
    assert.ok(q.includes('qstate live'), 'live pill rendered');
    assert.ok(q.includes('Now: Match '), 'Now header kept, not relabeled');
  });
});

describe('PART 2 (3): bracket rows show division + weight once', () => {
  it('row title carries the division; the sub never repeats the band (static)', () => {
    const row = p2section('const bracketRow', 'const pinned');
    assert.ok(row.length > 200, 'section extracted');
    assert.ok(row.includes('esc(b.division)'), 'title shows the full division');
    assert.ok(row.includes('wcount(b) + \' wrestlers'), 'sub counts wrestlers');
    assert.ok(!row.includes('parseDiv(b.division).band'), 'band no longer extracted for the row');
    assert.ok(!row.includes('esc(band)'), 'band never re-rendered');
  });
});

describe('PART 2 (4): sign-out clears the pill, identity, and session', () => {
  it('logout drops the grant; unknown grants are already out', () => {
    const db = blank();
    db.sessions['g1'] = 'acc-guardian';
    assert.deepEqual(logoutToken(db, 'g1'), { ok: true });
    assert.equal(db.sessions['g1'], undefined);
    assert.deepEqual(logoutToken(db, 'nope'), { ok: true });
  });
  it('no session and no account means no pill (static)', () => {
    const paint = p2section('function paintSession', 'function setMode');
    assert.ok(paint.includes('if (!S.session && !S.account)'), 'signed-out guard');
    assert.ok(paint.includes('Signed out: no role pill'), 'pill cleared at the root');
  });
  it('sign-out clears identity, selection, cache, UI state, and the server grant (static)', () => {
    const out = p2section('switchsession', 'search');
    for (const s of ['S.token = null', 'S.account = null', 'S.wrestlerId = null', 'S.cache = {}',
      'S.expanded = []', 'S.afterSpectator = null', '/api/auth/logout']) {
      assert.ok(out.includes(s), `sign-out includes ${s}`);
    }
  });
});

describe('PART 2 (5): one canonical demo tournament dataset', () => {
  it('canonical demo tournament is demo-tournament (Demo Youth Open) with pinned totals', () => {
    const demos = Object.values(P2.tournaments).filter((t) => t.is_demo);
    assert.equal(demos.length, 1, 'exactly one demo tournament');
    assert.equal(demos[0].id, 'demo-tournament');
    assert.equal(demos[0].name, 'Demo Youth Open');
    const regs = Object.values(P2.registrations).filter((r) => r.tournament_id === 'demo-tournament');
    assert.equal(regs.length, 38);
    const brackets = p2brackets();
    assert.equal(brackets.length, 5);
    assert.deepEqual(brackets.map((b) => b.division).sort(),
      ['Bantam 65-75', 'Exhibition 100-110', 'Junior 87-97', 'Midget 76-86', 'Novice Round-Robin']);
    const s = tournamentStats(P2, 'demo-tournament');
    assert.equal(s.wrestlers, 38);
    assert.equal(s.brackets, 5);
    assert.equal(s.matchesTotal, 76);
    assert.equal(s.matchesWrestled, 24);
    assert.equal(s.mats, 6);
    assert.deepEqual(s.matList, ['1A', '1B', '2A', '2B', '3A', '3B']);
    assert.equal(s.schools, 4);
    assert.equal(s.unattached, 2);
    assert.equal(s.decisions, 11);
    assert.equal(s.majors, 6);
    assert.equal(s.pins, 4);
    assert.equal(s.techFalls, 3);
    assert.equal(s.decisions + s.majors + s.pins + s.techFalls, s.matchesWrestled);
    assert.equal(s.fastestPin.sec, 135);
    // Bracket counts derive from the same dataset, not a separate total.
    const all = brackets.flatMap((b) => b.structure.matches);
    assert.equal(s.matchesTotal, all.length);
    assert.equal(s.matchesWrestled, all.filter((m) => m.status === 'completed' && m.result).length);
    assert.deepEqual(Object.fromEntries(brackets.map((b) => [b.division, b.structure.seeds.length])),
      { 'Bantam 65-75': 8, 'Midget 76-86': 8, 'Junior 87-97': 8, 'Novice Round-Robin': 8, 'Exhibition 100-110': 4 });
  });
  it('seed header states the built totals, not a stale separate count (static)', () => {
    const seedJs = readFileSync(new URL('../../server/src/seed.js', import.meta.url), 'utf8');
    assert.ok(seedJs.includes('2 unattached = 38 wrestlers'));
    assert.ok(!seedJs.includes('2 unattached = 34'));
  });
});

describe('PART 2 (6): sibling panel labeled Also watching with that wrestler\'s next', () => {
  it('sibling header labels Also watching with the sibling name and own countdown (static)', () => {
    const mine = p2section('async function myWrestler', '/* ---------------- Spectator');
    assert.ok(mine.includes('<h3>Also watching — \' + esc(kid.name) + \'</h3>'), 'Also watching label');
    assert.ok(mine.includes('kid.name + "\'s next"'), 'possessive countdown names the sibling');
    assert.ok(mine.includes('api(\'/wrestler/\' + kid.id + \'/snapshot\''), 'sibling match comes from the sibling snapshot');
  });
});

// ---------- PART 3: bulletin parity, search, sharing, brackets, packet, table ----------
const p3appJs = readFileSync(new URL('../../client/src/app.js', import.meta.url), 'utf8');
const p3srvJs = readFileSync(new URL('../../server/src/app.js', import.meta.url), 'utf8');
const p3indexHtml = readFileSync(new URL('../../client/src/index.html', import.meta.url), 'utf8');
const p3section = (start, end) => p3appJs.slice(p3appJs.indexOf(start), p3appJs.indexOf(end, p3appJs.indexOf(start)));
// In-process demo app: the same routes HTTP serves, via dispatch (no
// sockets, no dev-file writes). One demo build per file, cloned per test:
// the seed's module-level name pool is finite, so repeated full builds
// would exhaust it — clones keep full isolation without re-seeding.
const P3DB = buildDemo(blank());
function demoApp() {
  const db = structuredClone(P3DB);
  db.__noPersist = true;
  const app = createApp(db);
  const auth = (accountId) => {
    const token = `test-${accountId}-${Math.floor(Math.random() * 1e9)}`;
    db.sessions[token] = accountId;
    return { authorization: `Bearer ${token}` };
  };
  return { ...app, db, auth };
}
const qp = (o) => new URLSearchParams(o);

describe('PART 3 (a): bulletin one source rendered same everywhere', () => {
  it('normalize keeps expiry; clears-after wording derives from posting + expiry', () => {
    const out = normBullSrv([
      { text: 'x', author: 'Olive', at: '2026-11-07T08:00:00.000Z', pinned: true, expires: '2026-11-07T14:00:00.000Z' },
      { text: 'stays up forever' },
    ], '2026-11-07T12:00:00.000Z');
    assert.equal(out[0].expires, '2026-11-07T14:00:00.000Z');
    assert.equal(clearsAfterLabel(out[0]), 'Clears after 6h');
    assert.equal(clearsAfterLabel(out[1]), '');
    assert.equal('expires' in out[1], false, 'no expires key when none was set');
  });
  it('Brackets and Tournament tabs share one heading and one renderer (static)', () => {
    const spec = p3section('async function spectator', '/* ---------------- Organizer');
    const hub = p3section('async function tournament', '/* ---------------- Notes');
    for (const [name, src] of [['Brackets', spec], ['Tournament', hub]]) {
      assert.ok(src.includes('<h2>\' + icon(\'status\') + \' Bulletin</h2>'), `${name} heading`);
      assert.ok(src.includes('bulletinHTML('), `${name} uses the shared renderer`);
    }
    assert.ok(p3appJs.includes('if (e.pinned) bits.push(\'Pinned\')'), 'Pin marker shown');
    assert.ok(p3appJs.includes('const clears = clearsAfter(e)'), 'clears-after wording shown');
  });
  it('organizer post lands in Parent payloads with pin, author, timestamp, expiry (live routes)', async () => {
    const { dispatch, auth } = demoApp();
    const H = auth('acc-organizer');
    const exp = new Date(Date.now() + 6 * 3600000).toISOString();
    await dispatch('POST', '/api/tournaments/demo-tournament/bulletin', {
      headers: H, body: { text: '[Alert] Meta check', pinned: true, expires: exp },
    });
    for (const [name, res] of [
      ['spectate', await dispatch('GET', '/api/public/demo-tournament/spectate')],
      ['info', await dispatch('GET', '/api/tournaments/demo-tournament/info')],
    ]) {
      const bull = res.bulletin;
      const hit = bull.find((e) => typeof e === 'object' && e.text.includes('Meta check'));
      assert.ok(hit, `${name} carries the post`);
      assert.equal(hit.pinned, true, `${name} pin marker`);
      assert.ok(hit.author, `${name} author`);
      assert.ok(hit.at, `${name} timestamp`);
      assert.equal(hit.expires, exp, `${name} expiry`);
    }
  });
  it('packet carries the bulletin sections, generation time, and version (live routes)', async () => {
    const { dispatch } = demoApp();
    const html = (await dispatch('GET', '/api/packet/demo-tournament')).__html;
    for (const sec of ['Alerts', 'Parking', 'Snacks/Concessions', 'Raffles', 'General Info']) {
      assert.ok(html.includes(`<h3>${sec}</h3>`), `packet section ${sec}`);
    }
    assert.match(html, /Generated .*demo data v4/, 'generation time + demo version');
    assert.ok(html.includes('Park in the north lot'), 'seeded bulletin content present');
    assert.ok(html.includes('<h2>Day totals</h2>'), 'day totals section present');
    assert.ok(html.includes('Matches wrestled 24 of 76 · Pins 4 · Tech falls 3 · Majors 6 · Decisions 11'),
      'day totals match the hub stats source');
  });
});

describe('PART 3 (b): search fulfils the placeholder', () => {
  it('bout queries parse: "Match 7" hits when it exists', () => {
    assert.equal(parseBoutQuery('Match 7'), 7);
    assert.equal(parseBoutQuery('match7'), 7);
    assert.equal(parseBoutQuery('7'), 7);
    assert.equal(parseBoutQuery('bout 3'), 3);
    assert.equal(parseBoutQuery('#12'), 12);
    assert.equal(parseBoutQuery('Avery'), null);
    assert.equal(parseBoutQuery('River Club'), null);
    assert.equal(parseBoutQuery(''), null);
  });
  it('"Match 7" returns the bout through the live search route', async () => {
    const { dispatch } = demoApp();
    const r = await dispatch('GET', '/api/search', { query: qp({ q: 'Match 7', tournamentId: 'demo-tournament' }) });
    const hit = (r.results || []).find((x) => x.kind === 'bout' && x.label.startsWith('Match 7 '));
    assert.ok(hit, 'Match 7 bout result present');
    assert.ok(hit.bracketId, 'bout result carries its bracket for match-detail navigation');
    const clubs = await dispatch('GET', '/api/search', { query: qp({ q: 'River Club', tournamentId: 'demo-tournament' }) });
    const club = (clubs.results || []).find((x) => x.kind === 'club');
    assert.ok(club, 'club result present');
    assert.ok(Array.isArray(club.members) && club.members.length > 0, 'club carries members for the filtered view');
  });
  it('results route: bout to match detail, club to club-filtered view, as-you-type (static)', () => {
    const run = p3section('async function runSearch', 'document.addEventListener');
    assert.ok(run.includes('S.afterSpectator = { expand: x.bracketId, match: x.id }'), 'bout navigates to match detail');
    assert.ok(run.includes('S.clubFilter = { club: x.id, members: x.members || [] }'), 'club goes to club-filtered view');
    assert.ok(p3appJs.includes('addEventListener(\'input\''), 'results as-you-type');
    const spec = p3section('async function spectator', '/* ---------------- Organizer');
    assert.ok(spec.includes('Club: \' + esc(S.clubFilter.club)'), 'club filter banner renders');
    assert.ok(spec.includes('clubclear'), 'club filter clears');
  });
  it('Table Worker withholding is labeled, never silently empty (static)', () => {
    assert.ok(p3appJs.includes('hidden for Table Worker logins'), 'explicit table-worker label');
    assert.ok(p3appJs.includes('never silently dropped to empty'), 'label-before-empty rule stated');
  });
  it('organizer/table never see parent Notes, My Wrestler, Card Studio, family sharing (static)', () => {
    assert.ok(p3appJs.includes('organizer: [\'organizer\', \'spectator\', \'tournament\']'), 'organizer tabs exclude wrestler/notes/studio');
    assert.ok(p3appJs.includes('table: [\'table\', \'spectator\', \'tournament\']'), 'table tabs exclude wrestler/notes/studio');
    assert.ok(p3appJs.includes('const TABLE_OK = [\'table\', \'spectator\', \'tournament\', \'landing\']'), 'table gate excludes parent modes');
    assert.ok(p3indexHtml.includes('data-mode="studio" data-min="parent"'),
      'studio menu entry is parent-only');
    assert.ok(p3indexHtml.includes('data-mode="guest" data-min="parent,organizer,guest"'),
      'guest generator stays shared, not parent-private');
    const notes = p3section('async function notesView', '/* ---------------- Table:');
    assert.ok(notes.includes('S.account.role === \'guardian\''), 'family sharing renders for guardians only');
  });
});

describe('PART 3 (c): family sharing demonstrable after Create', () => {
  it('one invite, two readings: QR token + up-to-6-digit manual code, same grant', () => {
    const db = blank();
    const w = createWrestler(db, { name: 'Kid', grade: '5' });
    const inv = createInvite(db, w.id, { by: 'acc-guardian' });
    assert.match(inv.token, /^[0-9a-f]{32}$/);
    assert.match(inv.code, /^\d{6}$/);
    assert.ok(new Date(inv.expires_at) > new Date(), 'expiry in the future');
    const viaCode = acceptInvite(db, inv.code, 'acc-other');
    assert.equal(viaCode.status, 'pending');
    assert.equal(findInvite(db, inv.token).inv.code, inv.code, 'token and code read the same grant');
  });
  it('revoke kills both readings; revoked/expired invites refuse', () => {
    const db = blank();
    const w = createWrestler(db, { name: 'Kid', grade: '5' });
    const inv = createInvite(db, w.id, { by: 'acc-guardian' });
    assert.deepEqual(revokeInvite(db, inv.code, 'acc-guardian'), { ok: true });
    assert.throws(() => acceptInvite(db, inv.token, 'acc-x'), /invalid or revoked/);
    assert.throws(() => acceptInvite(db, inv.code, 'acc-x'), /invalid or revoked/);
    assert.throws(() => revokeInvite(db, 'nope', 'acc-guardian'), /not found/);
  });
  it('panel explains before Create; QR + code + expiry + Copy + Revoke after (static)', () => {
    const notes = p3section('async function notesView', '/* ---------------- Table:');
    assert.ok(notes.includes('After you tap Create invite'), 'pre-create explainer');
    assert.ok(notes.includes('No passwords are ever shared'), 'no shared credentials');
    assert.ok(notes.includes('qrSvg(\'arena:invite:\' + inv.token'), 'QR for the invite token');
    assert.ok(notes.includes('Manual code:'), 'manual code shown');
    assert.ok(notes.includes('Expires:'), 'expiry shown');
    assert.ok(notes.includes('id="sharecopy"'), 'Copy control');
    assert.ok(notes.includes('/sharing/revoke'), 'Revoke control');
    assert.ok(notes.includes('so they are hidden'), 'revoked QR/code hide with the note');
  });
});

describe('PART 3 (d): bracket generator dates, links, and viewable brackets', () => {
  it('short links name one bracket; scan codes are deterministic SVG', () => {
    assert.equal(bracketShortLink('demo-de-bantam'), '#b=demo-de-bantam');
    const a = qrSvg('arena:bracket:x', 72);
    assert.equal(a, qrSvg('arena:bracket:x', 72), 'deterministic');
    assert.ok(a.startsWith('<svg'), 'svg scan code');
    assert.notEqual(a, qrSvg('arena:bracket:y', 72), 'payload-sensitive');
  });
  it('generator keeps title/engine/print, adds a labeled date + viewable list (static)', () => {
    const g = p3section('async function guest', '/* ---------------- About');
    assert.ok(g.includes('id="gtitle"'), 'print-title field kept');
    assert.ok(g.includes('id="gdate"'), 'labeled date field');
    assert.ok(g.includes('fmtDate(gdate)'), 'date rendered like the tournament date');
    assert.ok(g.includes('api(\'/guest/bracket\''), 'same deterministic engine');
    assert.ok(g.includes('renderSheet'), 'same print renderer');
    assert.ok(g.includes('Viewable Brackets'), 'viewable list');
    assert.ok(g.includes('rememberScanned'), 'scanned brackets accumulate');
  });
  it('per-bracket link + code on the bracket page and packet, public view only (static)', () => {
    assert.ok(p3appJs.includes('data-linkpan'), 'bracket page link panels');
    assert.ok(p3appJs.includes('Never a family invite'), 'public-view-only wording in app');
    assert.ok(p3srvJs.includes('Never a family invite'), 'public-view-only wording in packet');
    assert.ok(p3srvJs.includes('bracketShortLink(b.id)'), 'packet embeds the short link');
    assert.ok(p3srvJs.includes('qrSvg(`arena:bracket:'), 'packet embeds the scan code');
  });
  it('packet sheets carry their own link + code payloads (live routes)', async () => {
    const { dispatch } = demoApp();
    const html = (await dispatch('GET', '/api/packet/demo-tournament')).__html;
    assert.ok(html.includes('#b=demo-de-bantam'), 'bantam sheet link');
    assert.ok(html.includes('Scan code'), 'scan code present');
    assert.ok(html.includes('Never a family invite'), 'public-view-only wording printed');
  });
});

describe('PART 3 (e): parent packet print uses the organizer renderer', () => {
  it('Brackets and Tournament views expose Print packet to the same route (static)', () => {
    const spec = p3section('async function spectator', '/* ---------------- Organizer');
    const hub = p3section('async function tournament', '/* ---------------- Notes');
    const org = p3section('async function organizer', 'async function tableMode');
    assert.ok(spec.includes('id="brkpacket"'), 'Brackets view print control');
    assert.ok(hub.includes('id="hubpacket"'), 'Tournament view print control');
    for (const [name, src] of [['Brackets', spec], ['Tournament', hub], ['Organizer', org]]) {
      assert.ok(src.includes('window.open(\'/api/packet/\' + '), `${name} uses the organizer packet renderer`);
    }
  });
});

describe('PART 3 (f): table sign-in log, Match wording, named undo', () => {
  it('log projects name, mat, in/out, shift, handoff; clockout promotes', () => {
    const db = blank();
    clockIn(db, 't1', '1', 'Ann', 'table');
    clockIn(db, 't1', '1', 'Ben', 'table');
    let log = tableLog(db, 't1');
    assert.equal(log.length, 1);
    assert.equal(log[0].table, '1');
    assert.deepEqual(log[0].workers.map((w) => w.name), ['Ann', 'Ben']);
    assert.ok(log[0].workers.every((w) => w.shift === 'on shift' && w.out === null));
    const out = clockOut(db, 't1', '1', 'Ann', 'table');
    assert.equal(out.promoted.name, 'Ben');
    log = tableLog(db, 't1');
    const ann = log[0].workers.find((w) => w.name === 'Ann');
    assert.ok(ann.out, 'sign-out time recorded');
    assert.equal(ann.shift, 'off shift');
    assert.equal(ann.handoff, 'Ben', 'handoff recorded');
  });
  it('same log panel in Table Worker and Organizer Table views (static)', () => {
    assert.ok(p3appJs.includes('async function renderTableLog'), 'shared log panel');
    assert.ok(p3appJs.includes('Sign-in log'), 'log heading');
    const tv = p3section('async function tableView', '/* ---------------- Bracket Generator');
    const tm = p3section('async function tableMode', '/* ---------------- Tournament setup');
    assert.ok(tv.includes('renderTableLog('), 'Table Worker view shows the log');
    assert.ok(tm.includes('renderTableLog('), 'Organizer Table view shows the log');
    assert.ok(p3appJs.includes('handoff to'), 'handoff visible');
  });
  it('a contest is a Match everywhere; distance counts stay "bouts" (static)', () => {
    for (const s of [`Table ' + esc(tbl) + ' · Match '`, 'Match finalized.', 'No matches assigned',
      'Done — no more matches.', 'No matches yet today.', 'Rest between matches',
      'LAST MATCH', 'last match ended', 'Undo last point']) {
      assert.ok(p3appJs.includes(s), `client says "${s}"`);
    }
    for (const s of ['LAST BOUT', '>UNDO<', 'Bout finalized.', 'No bouts assigned',
      'Done — no more bouts.', 'Rest between bouts', 'Table 1 · Bout ', 'min between bouts']) {
      assert.ok(!p3appJs.includes(s), `client no longer says "${s}"`);
    }
    const studioJs = readFileSync(new URL('../../client/src/studio.js', import.meta.url), 'utf8');
    for (const s of [`'Bout '`, `'a bout'`, 'finalized bout']) {
      assert.ok(!studioJs.includes(s), `studio no longer says "${s}"`);
    }
    assert.ok(studioJs.includes('win a finalized match'), 'studio milestone copy uses Match');
    assert.ok(p3indexHtml.includes('placeholder="Search wrestlers, matches, clubs, brackets"'), 'search placeholder uses matches');
    assert.ok(p3appJs.includes('bouts away'), 'distance count "bouts away" stays');
    assert.ok(p3appJs.includes('bouts apart'), 'distance count "bouts apart" stays');
    assert.ok(p3srvJs.includes('· Match ${m.bout_number}'), 'spectator labels use Match');
  });
  it('finalize confirms in-view, advances, and explains failures (static)', () => {
    const tm = p3section('async function tableMode', '/* ---------------- Tournament setup');
    const fin = tm.slice(tm.indexOf('id="final"'));
    assert.ok(!fin.includes('prompt('), 'finalize never uses blocking prompts');
    assert.ok(!fin.includes('alert('), 'finalize never uses blocking alerts');
    for (const s of ['Match finalized.', 'Could not finalize', 'Next match', 'Confirm final', 'data-win=', 'data-out=']) {
      assert.ok(fin.includes(s), `finalize flow shows "${s}"`);
    }
  });
  it('sign-in log refreshes the moment a sign-in exists, in its own panel (static)', () => {
    const tm = p3section('async function tableMode', '/* ---------------- Tournament setup');
    assert.ok(tm.includes('<div id="tboardlog"></div>'), 'board log has its own mount');
    assert.ok(tm.includes(`renderTableLog('tboardlog'`), 'board paints its own log');
    const clockIdx = tm.indexOf('/table/clockin');
    const refreshIdx = tm.indexOf(`renderTableLog('tlog'`);
    assert.ok(clockIdx >= 0 && refreshIdx > clockIdx, 'landing log refreshes after sign-in');
  });
  it('scoreboard picks any table in play and hands off on switch (static)', () => {
    const tm = p3section('async function tableMode', '/* ---------------- Tournament setup');
    assert.ok(tm.includes("'/table/' + tid + '/tables'"), 'tables come from the server');
    assert.ok(tm.includes('data-table='), 'table picker chips present');
    assert.ok(tm.includes("'/table/' + tid + '/queue?table=' + encodeURIComponent(tbl)"), 'queue follows the picked table');
    assert.ok(tm.includes("'/table/clockout'"), 'switching tables clocks out first (handoff)');
    assert.ok(tm.includes('tableMode(name, tbl)'), 'finalize advances on the same table');
  });
  it('scoreboard undo names the play it takes back (static)', () => {
    const tm = p3section('async function tableMode', '/* ---------------- Tournament setup');
    assert.ok(tm.includes('id="undo">Undo last point<'), 'undo names the play');
    assert.ok(tm.includes('Undo last point: take back'), 'undo names the scored play');
    assert.ok(tm.includes('Took back \' + r.undone.side + \' +\' + r.undone.points'), 'undo confirms what was taken back');
  });
});

describe('PART 3 (live routes): notes save, sharing lifecycle, table score/finalize/log', () => {
  it('guardian note saves on the first tap and reads back', async () => {
    const { dispatch, auth, db } = demoApp();
    const link0 = Object.values(db.guardianLinks).find((l) => l.account_id === 'acc-guardian' && l.status === 'approved');
    const kid = db.wrestlers[link0.wrestler_id];
    const saved = await dispatch('POST', '/api/notes', {
      headers: auth('acc-guardian'),
      body: { wrestlerId: kid.id, tournamentId: 'demo-tournament', body: 'first-tap probe', scope: 'private' },
    });
    assert.equal(saved.body, 'first-tap probe');
    const back = await dispatch('GET', '/api/notes', {
      headers: auth('acc-guardian'),
      query: qp({ tournamentId: 'demo-tournament', wrestlerId: kid.id }),
    });
    assert.ok(back.notes.some((n) => n.body === 'first-tap probe'), 'saved note reads back');
  });
  it('invite route mints token + code; accept by code; revoke by token', async () => {
    const { dispatch, auth, db } = demoApp();
    const link0 = Object.values(db.guardianLinks).find((l) => l.account_id === 'acc-guardian' && l.status === 'approved');
    const kid = db.wrestlers[link0.wrestler_id];
    const inv = await dispatch('POST', '/api/sharing/invite', {
      headers: auth('acc-guardian'), body: { wrestlerId: kid.id },
    });
    assert.match(inv.token, /^[0-9a-f]{32}$/);
    assert.match(inv.code, /^\d{6}$/);
    assert.ok(inv.expires_at);
    db.accounts['acc-kin'] = { id: 'acc-kin', role: 'guardian', name: 'Kin' };
    const link = await dispatch('POST', '/api/sharing/accept', {
      headers: auth('acc-kin'), body: { code: inv.code },
    });
    assert.equal(link.status, 'pending');
    assert.deepEqual(await dispatch('POST', '/api/sharing/revoke', {
      headers: auth('acc-guardian'), body: { token: inv.token },
    }), { ok: true });
    await assert.rejects(
      dispatch('POST', '/api/sharing/accept', { headers: auth('acc-kin'), body: { code: inv.code } }),
      /invalid or revoked/);
  });
  it('table flow: clockin, score, undo, finalize, sign-in log', async () => {
    const { dispatch, auth } = demoApp();
    const H = auth('acc-table1');
    const rec = await dispatch('POST', '/api/table/clockin', {
      headers: H, body: { tournamentId: 'demo-tournament', table: '1', name: 'Demo Probe' },
    });
    assert.equal(rec.name, 'Demo Probe');
    const q = await dispatch('GET', '/api/table/demo-tournament/queue', { headers: H, query: qp({ table: '1' }) });
    assert.ok(q.queue.length > 0, 'table 1 has a queue');
    const m0 = q.queue[0];
    const scored = await dispatch('POST', '/api/table/score', {
      headers: H,
      body: { tournamentId: 'demo-tournament', bracketId: m0.bracket_id, matchId: m0.match_id, play: { side: 'red', points: 3, label: 'red +3' } },
    });
    assert.equal(scored.red, 3, 'play log is the live source of truth');
    const undone = await dispatch('POST', '/api/table/undo', {
      headers: H, body: { tournamentId: 'demo-tournament', bracketId: m0.bracket_id, matchId: m0.match_id },
    });
    assert.equal(undone.undone.points, 3);
    assert.equal(undone.undone.side, 'red');
    const fin = await dispatch('POST', '/api/table/finalize', {
      headers: H,
      body: { tournamentId: 'demo-tournament', bracketId: m0.bracket_id, matchId: m0.match_id, winner: 'RED', outcome: 'decision' },
    });
    assert.equal(fin.ok, true);
    assert.equal(fin.result.outcome, 'decision');
    await dispatch('POST', '/api/table/clockout', {
      headers: H, body: { tournamentId: 'demo-tournament', table: '1', name: 'Demo Probe' },
    });
    const log = await dispatch('GET', '/api/table/demo-tournament/log', { headers: H });
    const t1 = log.log.find((t) => t.table === '1');
    const me = t1.workers.find((w) => w.name === 'Demo Probe');
    assert.ok(me.in && me.out, 'sign-in and sign-out times recorded');
    assert.equal(me.shift, 'off shift');
  });
  it('finalize confirms with a displayable summary; repeat finalize explains why', async () => {
    const { dispatch, auth } = demoApp();
    const H = auth('acc-table1');
    await dispatch('POST', '/api/table/clockin', {
      headers: H, body: { tournamentId: 'demo-tournament', table: '1', name: 'Fin Probe' },
    });
    const q = await dispatch('GET', '/api/table/demo-tournament/queue', { headers: H, query: qp({ table: '1' }) });
    const m0 = q.queue[0];
    const fin = await dispatch('POST', '/api/table/finalize', {
      headers: H,
      body: { tournamentId: 'demo-tournament', bracketId: m0.bracket_id, matchId: m0.match_id, winner: 'GREEN', outcome: 'pin' },
    });
    assert.equal(fin.ok, true);
    assert.equal(fin.summary.winnerSide, 'GREEN');
    assert.equal(fin.summary.winnerName, m0.b);
    assert.equal(fin.summary.outcome, 'pin');
    await assert.rejects(
      dispatch('POST', '/api/table/finalize', {
        headers: H,
        body: { tournamentId: 'demo-tournament', bracketId: m0.bracket_id, matchId: m0.match_id, winner: 'GREEN', outcome: 'pin' },
      }),
      /already completed; use the correction workflow/);
  });
  it('tables route lists distinct mat prefixes; each table queues its own matches (live routes)', async () => {
    const { dispatch, auth } = demoApp();
    const { tables } = await dispatch('GET', '/api/table/demo-tournament/tables', { headers: auth('acc-table1') });
    assert.deepEqual(tables, ['1', '2', '3']);
    for (const t of tables) {
      const q = await dispatch('GET', '/api/table/demo-tournament/queue', { headers: auth('acc-table1'), query: qp({ table: t }) });
      assert.ok(q.queue.length > 0, `table ${t} has queued matches`);
      assert.ok(q.queue.every((m) => String(m.mat).startsWith(t)), `table ${t} queue matches its mats`);
    }
  });
});

describe('day totals: one decided-match dataset; buckets never exceed completed', () => {
  const check = (db, label) => {
    const s = tournamentStats(db, 'demo-tournament');
    const decided = s.matchesWrestled;
    for (const k of ['pins', 'techFalls', 'majors', 'decisions', 'injuryDefaults', 'forfeits']) {
      assert.ok(s[k] <= decided, `${label}: ${k}=${s[k]} <= completed=${decided}`);
    }
    assert.equal(s.pins + s.techFalls + s.majors + s.decisions + s.injuryDefaults + s.forfeits, decided,
      `${label}: outcome buckets sum to completed matches`);
  };
  it('fresh seed and post-finalize stats both satisfy the invariant (live routes)', async () => {
    const { dispatch, auth, db } = demoApp();
    check(db, 'fresh seed');
    const H = auth('acc-table1');
    await dispatch('POST', '/api/table/clockin', {
      headers: H, body: { tournamentId: 'demo-tournament', table: '1', name: 'Stat Probe' },
    });
    const q = await dispatch('GET', '/api/table/demo-tournament/queue', { headers: H, query: qp({ table: '1' }) });
    const m0 = q.queue[0];
    await dispatch('POST', '/api/table/finalize', {
      headers: H,
      body: { tournamentId: 'demo-tournament', bracketId: m0.bracket_id, matchId: m0.match_id, winner: 'RED', outcome: 'decision' },
    });
    check(db, 'after finalize');
  });
  it('bracket rows count decided with the same predicate as stats (static)', () => {
    const spec = p3section('async function spectator', '/* ---------------- Organizer');
    assert.ok(spec.includes("m.status === 'completed' && m.outcome != null"), 'rows count decided matches only');
    const tourJs = readFileSync(new URL('../../server/src/tournament.js', import.meta.url), 'utf8');
    assert.ok(tourJs.includes('matches.filter(isDecided)'), 'stats count the same decided set');
  });
});

describe('card presets: named art-layer prompt sets, never border-colour swaps', () => {
  const ALL = ['classic', 'shiny-glittery', 'fire', 'ice', 'lightning', 'attack', 'brick-wall', 'super-silly', 'friendly', 'fierce', 'a-little-scary'];
  it('eleven presets each define pose, background, palette, finish, and energy', () => {
    assert.deepEqual(CARD_PRESET_IDS, ALL);
    for (const id of ALL) {
      const p = CARD_PRESETS[id];
      assert.ok(p.name, `${id} named`);
      for (const k of ['pose', 'background', 'palette', 'finish', 'energy']) {
        assert.ok(p[k] && p[k].length > 8, `${id}.${k} set`);
      }
    }
  });
  it('pickPreset round-trips ids, resolves mystery per call, falls back honestly', () => {
    for (const id of ALL) assert.equal(pickPreset(id), id);
    assert.equal(pickPreset('mystery', () => 0), ALL[0]);
    assert.equal(pickPreset('mystery', () => 0.999), ALL[ALL.length - 1]);
    assert.equal(pickPreset('shuffle', () => 0.5), ALL[Math.floor(0.5 * ALL.length)]);
    assert.equal(pickPreset('nope'), 'classic');
    assert.equal(pickPreset('shiny'), 'shiny-glittery', 'legacy style maps on');
  });
  it('art prompts embed all five preset layers, the no-text rule, and per-variant words', () => {
    const a = buildArtPrompt({ answers: { preset: 'fire', color: 'red' }, hero: 'boy hero', variantWord: VARIANT_WORDS[0] });
    for (const frag of [CARD_PRESETS.fire.pose, CARD_PRESETS.fire.background, CARD_PRESETS.fire.palette, CARD_PRESETS.fire.finish, CARD_PRESETS.fire.energy]) {
      assert.ok(a.includes(frag), 'fire layer present');
    }
    assert.match(a, /STRICT: no text, no letters, no numbers/);
    assert.ok(a.includes(VARIANT_WORDS[0]));
    const b = buildArtPrompt({ answers: { preset: 'ice' }, hero: 'boy hero', variantWord: VARIANT_WORDS[1] });
    assert.notEqual(a, b, 'different presets/words differ');
    const legacy = buildArtPrompt({ answers: { style: 'fire', color: 'blue', animal: 'tiger' }, hero: 'x' });
    assert.ok(legacy.includes('Preset Fire:'), 'legacy style answers still resolve');
  });
});

describe('image route: image model only, exact request in failures', () => {
  it('refuses a text model ID on the image route before any network call', async () => {
    const art = new MetaCardArtProvider({ USE_REAL_META_AI: 'true', META_MODEL_API_KEY: 'k', META_MODEL_IMAGE: 'muse-spark-1.3' });
    await assert.rejects(() => art.generateArt({ prompt: 'x' }), /text model ID.*text routes/);
  });
  it('raw b64_json art is wrapped as a data URL so <img> renders it', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUg' }] }) });
    try {
      const art = new MetaCardArtProvider({ USE_REAL_META_AI: 'true', META_MODEL_API_KEY: 'k' });
      const out = await art.generateArt({ prompt: 'x' });
      assert.equal(out.art, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg');
      assert.equal(out.isMock, false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  it('live failures name the exact URL and model sent', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => '' });
    try {
      const art = new MetaCardArtProvider({ USE_REAL_META_AI: 'true', META_MODEL_API_KEY: 'k' });
      await assert.rejects(() => art.generateArt({ prompt: 'x' }),
        /POST https:\/\/api\.meta\.ai\/v1\/images\/generations \(model muse-image-1\.0\) failed \(404\)/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('studio flow: guided questions, presets, art-window card (static)', () => {
  const studioJs = readFileSync(new URL('../../client/src/studio.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../client/src/styles.css', import.meta.url), 'utf8');
  it('core questions, drawn pool, shuffle, and all 12 preset chips', () => {
    for (const s of ['Friendly', 'Fierce', 'A little scary', 'Attack', 'Brick-wall defense', 'Super silly']) {
      assert.ok(studioJs.includes(s), `core answer "${s}" present`);
    }
    assert.ok(studioJs.includes('QSETS_POOL'), 'drawn pool present');
    assert.ok(studioJs.includes('Shuffle questions'), 'shuffle button present');
    for (const id of ['classic', 'shiny-glittery', 'fire', 'ice', 'lightning', 'attack', 'brick-wall', 'super-silly', 'friendly', 'fierce', 'a-little-scary', 'mystery']) {
      assert.ok(studioJs.includes(`id: '${id}'`), `preset chip "${id}" present`);
    }
  });
  it('template-first card: art composited into the art window, school-driven design, foil finishes', () => {
    assert.ok(studioJs.includes('<div class="artwin">'), 'art window present');
    assert.ok(!studioJs.includes('artfill'), 'no floating overlay layer');
    assert.ok(studioJs.includes('schoolStyle'), 'school colours drive the design');
    for (const id of ['brick-wall', 'super-silly', 'friendly', 'fierce', 'a-little-scary', 'shiny-glittery', 'attack']) {
      assert.ok(css.includes(`.fin-${id}`), `finish treatment .fin-${id} present`);
    }
    assert.ok(css.includes('foilsheen'), 'foil sheen sweep present');
  });
  it('regen previews the kept set together with preset names, no re-roll path', () => {
    assert.ok(studioJs.includes('regenStrip'), 'preview-together strip present');
    assert.ok(studioJs.includes('no re-rolls'), 'no re-roll wording present');
    assert.ok(studioJs.includes('presetName'), 'variant preset names shown');
  });
});

describe('seed rebuild: live demo-regen art survives a version-bump purge', () => {
  it('kept cards, owner wrestler, and display record persist across rebuild', async () => {
    const db = buildDemo(blank());
    const w = Object.values(db.wrestlers).find((x) => x.is_demo);
    const stub = {
      isMock: false, label: 'meta:t',
      generateArt: async () => ({ art: 'data:image/png;base64,KEPT', provider: 'meta:t', isMock: false }),
    };
    const kept = await demoRegenerateCard(db, w.id, 'S1', { artProvider: stub });
    db.tournaments['demo-tournament'].demoVersion = 3; // force stale
    buildDemo(db); // purge + rebuild in place
    assert.equal(db.tournaments['demo-tournament'].demoVersion, 4);
    for (const c of kept) {
      assert.ok(db.cards[c.id], 'regen card survives');
      assert.equal(db.cards[c.id].art, 'data:image/png;base64,KEPT');
    }
    assert.ok(db.wrestlers[w.id], 'owner wrestler survives');
  });
});

describe('offline: service worker caches hub reads and labels stale', () => {
  it('sw caches tournament info/stats GETs and tags fallback responses (static)', () => {
    const sw = readFileSync(new URL('../../client/src/sw.js', import.meta.url), 'utf8');
    assert.ok(sw.includes('/api/tournaments/'), 'hub endpoints cached');
    assert.ok(sw.includes("e.request.method !== 'GET'"), 'reads only');
    assert.ok(sw.includes('X-Arena-Stale'), 'stale fallback tagged');
  });
  it('app footer shows the stale line on tagged responses (static)', () => {
    assert.ok(p3appJs.includes("res.headers.get('X-Arena-Stale')"), 'stale header flips the sync banner');
  });
});

describe('responsive: phone-first contracts hold at 390px (static)', () => {
  it('fluid view, wrap-everywhere rows, capped card, intentional bracket scroll only', () => {
    const css = readFileSync(new URL('../../client/src/styles.css', import.meta.url), 'utf8');
    for (const [s, why] of [
      ['#view { padding: 14px 12px 8px; max-width: 860px; margin: 0 auto; width: 100%; }', 'fluid view column'],
      ['.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }', 'rows wrap'],
      ['.chipline { display: flex; gap: 8px; flex-wrap: wrap;', 'chip rows wrap'],
      ['.cardframe { width: min(78vw, 300px);', 'card fits phone width'],
      ['.brk-scroll { overflow-x: auto;', 'bracket diagrams scroll inside their container'],
      ['position: fixed; left: 0; right: 0; bottom: 0;', 'bottom nav pinned on phone'],
    ]) assert.ok(css.includes(s), why);
  });
});
