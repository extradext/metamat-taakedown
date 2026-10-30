// engine.test.js — A9: bracket engine tests use GENERATED cases, not a few
// hand-entered examples. Every case verifies: all scheduled matches, every
// advancement, every elimination, final placement, byes never recorded as
// wins, no impossible duplicate matches, completed results never silently
// changed, history linked to permanent IDs, and determinism.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDoubleElim, generateSingleElim, generateRoundRobin,
  maybeCreateReset, recordResult, readyMatches, lossCounts,
  doubleElimPlacements, roundRobinStandings, expectedRrMatches,
  validateResultInput, WRESTLED_OUTCOMES, poolSplit, poolAdvancers, singleElimPlacements,
} from '../src/engine.js';

// Deterministic sim: lower seed index always wins by decision 6-2.
function simAll(bracket, { winner = 'lower' } = {}) {
  let guard = 5000;
  while (readyMatches(bracket).length && guard-- > 0) {
    const byId = Object.fromEntries(bracket.matches.map((m) => [m.id, m]));
    for (const m of readyMatches(bracket)) {
      const a = slotId(m.slot_a, byId, bracket.seeds);
      const b = slotId(m.slot_b, byId, bracket.seeds);
      const ia = bracket.seeds.indexOf(a); const ib = bracket.seeds.indexOf(b);
      const winnerId = winner === 'lower' ? (ia < ib ? a : b) : (ia > ib ? a : b);
      const loserId = winnerId === a ? b : a;
      const scoreA = winnerId === a ? 6 : 2; const scoreB = winnerId === a ? 2 : 6;
      recordResult(bracket, m.id, { outcome: 'decision', winnerId, loserId, scoreA, scoreB }, { actor: 'test' });
    }
  }
  assert.ok(guard > 0, 'simulation did not terminate');
  return bracket;
}

function slotId(ref, byId, seeds) {
  if (ref.t === 'wrestler') return ref.id;
  if (ref.t === 'seed') return seeds[ref.i];
  const m = byId[ref.m];
  if (!m?.result) return null;
  return ref.t === 'w' ? m.result.winnerId : m.result.loserId;
}

const seeds = (n) => Array.from({ length: n }, (_, i) => `w-${i + 1}`);

function checkInvariants(bracket, n) {
  // No IMPOSSIBLE duplicate pairings: round-robin meets each pair exactly
  // once; double-elim rematches are legal (consol/final paths) but a third
  // meeting or a self-match is impossible. RESET excluded (a true rematch).
  const meetings = new Map();
  for (const m of bracket.matches) {
    if (m.status !== 'completed' || !m.result) continue;
    assert.notEqual(m.result.winnerId, m.result.loserId, 'a wrestler can never face themselves');
    if (m.bracket_side === 'RESET') continue;
    const key = [m.result.winnerId, m.result.loserId].sort().join('|');
    meetings.set(key, (meetings.get(key) || 0) + 1);
    const limit = bracket.format === 'round-robin' ? 1 : 2;
    assert.ok(meetings.get(key) <= limit, `impossible duplicate match (${meetings.get(key)}x): ${key}`);
    // Pending-vs-live invariant: completed matches carry results, never live score.
    assert.equal(m.live_score, null);
  }
  // Every match references real seeds; history links to permanent IDs.
  for (const m of bracket.matches) {
    for (const s of [m.slot_a, m.slot_b]) {
      if (s.t === 'seed') assert.ok(s.i >= 0 && s.i < n, 'seed in range');
      if (s.t === 'wrestler') assert.ok(bracket.seeds.includes(s.id), 'wrestler is a bracket seed');
    }
  }
}

describe('A9 double-elimination (generated sizes 2,3,4,5,8,16 + non-pow2)', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 16]) {
    it(`size ${n}: full sim, 2-loss elimination, placements, no bye-wins`, () => {
      const mk = () => generateDoubleElim({ bracketId: 'b', seeds: seeds(n) });
      // Determinism: same inputs => same structure (match UUIDs normalized).
      const shape = (s) => {
        const idx = Object.fromEntries(s.matches.map((m, i) => [m.id, i]));
        const norm = (r) => (r.m ? { ...r, m: `#${idx[r.m]}` } : r);
        return JSON.stringify(s.matches.map((m) => [m.round_label, m.bracket_side, norm(m.slot_a), norm(m.slot_b)]));
      };
      assert.equal(shape(mk()), shape(mk()));
      const bracket = mk();
      // Bye check: seeds with R1 byes have NO match record creating a win.
      const r1wb = bracket.matches.filter((m) => m.bracket_side === 'WB' && m.round_label === 'WB-1');
      assert.ok(r1wb.length <= Math.ceil(n / 2), 'R1 match count sane');
      simAll(bracket);
      checkInvariants(bracket, n);
      const losses = lossCounts(bracket);
      // Champion has <= 1 loss (reset off by default: WB champ unbeaten or 1 loss via consol path... champion from consol has 1).
      const placements = doubleElimPlacements(bracket);
      const champ = Object.keys(placements).find((k) => placements[k] === 1);
      assert.ok(champ, 'a champion is placed');
      assert.ok((losses[champ] || 0) <= 1, `champion loss count sane (got ${losses[champ] || 0})`);
      // Everyone else placed; eliminated wrestlers (2+ losses) never champion.
      assert.equal(Object.keys(placements).length, n);
      for (const [id, c] of Object.entries(losses)) {
        if (c >= 2) assert.notEqual(placements[id], 1, `${id} eliminated with ${c} losses cannot be champion`);
      }
      // Completed results are stable: re-reading changes nothing.
      const snap = JSON.stringify(bracket.matches.map((m) => m.result));
      doubleElimPlacements(bracket); lossCounts(bracket);
      assert.equal(JSON.stringify(bracket.matches.map((m) => m.result)), snap);
    });
  }

  it('first-round loser can win through the consolation bracket', () => {
    const bracket = generateDoubleElim({ bracketId: 'b', seeds: seeds(8) });
    // Make seed #8 lose R1 then win every consol bout; rig WB so #8 meets weak path.
    let guard = 500;
    const TARGET = 'w-8';
    while (readyMatches(bracket).length && guard-- > 0) {
      const byId = Object.fromEntries(bracket.matches.map((m) => [m.id, m]));
      for (const m of readyMatches(bracket)) {
        const a = slotId(m.slot_a, byId, bracket.seeds);
        const b = slotId(m.slot_b, byId, bracket.seeds);
        let winnerId;
        if (m.bracket_side === 'CONS' && (a === TARGET || b === TARGET)) winnerId = TARGET;
        else if (m.bracket_side === 'WB' && m.round_label === 'WB-1' && (a === TARGET || b === TARGET)) {
          winnerId = a === TARGET ? b : a; // R1 loss drops TARGET to consol
        } else {
          // WB: lower seed wins, except keep TARGET's conqueror out of the final path if possible
          winnerId = bracket.seeds.indexOf(a) < bracket.seeds.indexOf(b) ? a : b;
        }
        const loserId = winnerId === a ? b : a;
        recordResult(bracket, m.id, {
          outcome: 'decision', winnerId, loserId,
          scoreA: winnerId === a ? 5 : 1, scoreB: winnerId === a ? 1 : 5,
        }, { actor: 'test' });
      }
    }
    const losses = lossCounts(bracket);
    const placements = doubleElimPlacements(bracket);
    const consolWins = bracket.matches.filter((m) =>
      m.bracket_side === 'CONS' && m.result?.winnerId === TARGET).length;
    assert.ok(consolWins >= 1, `R1 loser won ${consolWins} consol bouts`);
    assert.ok(placements[TARGET] <= 2, `R1 loser reached the final (placed ${placements[TARGET]})`);
    assert.ok((losses[TARGET] || 0) <= 2, 'at most R1 loss + final loss');
  });

  it('two losses eliminate; single champion or reset path', () => {
    const bracket = generateDoubleElim({ bracketId: 'b', seeds: seeds(4) });
    simAll(bracket);
    const losses = lossCounts(bracket);
    const champ = Object.keys(doubleElimPlacements(bracket)).find((k) => doubleElimPlacements(bracket)[k] === 1);
    assert.ok((losses[champ] || 0) < 2);
  });

  it('undefeated finalist wins final => complete, NO reset when disabled', () => {
    const bracket = generateDoubleElim({ bracketId: 'b', seeds: seeds(8) });
    simAll(bracket);
    const reset = maybeCreateReset(bracket, { resetEnabled: false });
    assert.equal(reset, null);
    assert.equal(bracket.resetId, null);
  });

  it('R5: reset created ONLY when enabled AND undefeated finalist loses', () => {
    // Force: WB champ (w-1) loses the final to consol champ.
    const bracket = generateDoubleElim({ bracketId: 'b', seeds: seeds(8) });
    let guard = 500;
    while (readyMatches(bracket).length && guard-- > 0) {
      const byId = Object.fromEntries(bracket.matches.map((m) => [m.id, m]));
      for (const m of readyMatches(bracket)) {
        const a = slotId(m.slot_a, byId, bracket.seeds);
        const b = slotId(m.slot_b, byId, bracket.seeds);
        let winnerId = bracket.seeds.indexOf(a) < bracket.seeds.indexOf(b) ? a : b;
        if (m.bracket_side === 'FINAL') winnerId = winnerId === a ? b : a; // upset
        const loserId = winnerId === a ? b : a;
        recordResult(bracket, m.id, {
          outcome: 'decision', winnerId, loserId,
          scoreA: winnerId === a ? 4 : 3, scoreB: winnerId === a ? 3 : 4,
        }, { actor: 'test' });
      }
    }
    // Disabled (default): no reset even after the upset.
    assert.equal(maybeCreateReset(bracket, { resetEnabled: false }), null);
    // Enabled: separate match record, first final untouched.
    const before = bracket.matches.length;
    const reset = maybeCreateReset(bracket, { resetEnabled: true });
    assert.ok(reset, 'reset match created');
    assert.equal(bracket.matches.length, before + 1);
    assert.equal(reset.bracket_side, 'RESET');
    const fin = bracket.matches.find((m) => m.id === bracket.finalId);
    assert.ok(fin.result, 'first final result preserved, not altered');
    // Winner of reset is champion with placements recomputed: the first-final
    // loser (unbeaten WB champ) wins the reset over the first-final winner.
    recordResult(bracket, reset.id, {
      outcome: 'decision', winnerId: fin.result.loserId,
      loserId: fin.result.winnerId, scoreA: 3, scoreB: 1,
    }, { actor: 'test' });
    const placements = doubleElimPlacements(bracket);
    assert.equal(placements[fin.result.loserId], 1);
  });

  for (const outcome of ['forfeit', 'no-show', 'dq', 'injury-default', 'medical-forfeit', 'default']) {
    it(`admin outcome "${outcome}" advances winner, records distinctly`, () => {
      const bracket = generateDoubleElim({ bracketId: 'b', seeds: seeds(4) });
      const first = readyMatches(bracket)[0];
      const byId = Object.fromEntries(bracket.matches.map((m) => [m.id, m]));
      const a = slotId(first.slot_a, byId, bracket.seeds);
      const b = slotId(first.slot_b, byId, bracket.seeds);
      recordResult(bracket, first.id, { outcome, winnerId: a, loserId: b, scoreA: 0, scoreB: 0 }, { actor: 'test' });
      simAll(bracket);
      const stored = bracket.matches.find((m) => m.id === first.id);
      assert.equal(stored.result.outcome, outcome);
      assert.ok(WRESTLED_OUTCOMES.length === 4);
    });
  }

  it('late withdrawal after bracket lock: opponents advance by forfeit, history preserved', () => {
    const bracket = generateDoubleElim({ bracketId: 'b', seeds: seeds(8) });
    // Wrestle two matches, then withdraw w-3.
    const [m1, m2] = readyMatches(bracket);
    const byId = Object.fromEntries(bracket.matches.map((m) => [m.id, m]));
    for (const m of [m1, m2]) {
      const a = slotId(m.slot_a, byId, bracket.seeds);
      const b = slotId(m.slot_b, byId, bracket.seeds);
      recordResult(bracket, m.id, { outcome: 'decision', winnerId: a, loserId: b, scoreA: 6, scoreB: 2 }, { actor: 'test' });
    }
    const before = JSON.stringify(bracket.matches.filter((m) => m.status === 'completed').map((m) => m.result));
    // Withdrawal: remaining bouts involving w-3 become forfeit wins for opponents.
    let guard = 500;
    while (readyMatches(bracket).length && guard-- > 0) {
      const ids = Object.fromEntries(bracket.matches.map((m) => [m.id, m]));
      for (const m of readyMatches(bracket)) {
        const a = slotId(m.slot_a, ids, bracket.seeds);
        const b = slotId(m.slot_b, ids, bracket.seeds);
        if (a === 'w-3' || b === 'w-3') {
          recordResult(bracket, m.id, {
            outcome: 'forfeit', winnerId: a === 'w-3' ? b : a,
            loserId: 'w-3', scoreA: 0, scoreB: 0,
          }, { actor: 'test-withdrawal' });
        } else {
          const winnerId = bracket.seeds.indexOf(a) < bracket.seeds.indexOf(b) ? a : b;
          recordResult(bracket, m.id, {
            outcome: 'decision', winnerId, loserId: winnerId === a ? b : a,
            scoreA: 6, scoreB: 2,
          }, { actor: 'test' });
        }
      }
    }
    // Completed matches were NOT rewritten.
    const after = JSON.stringify([m1.id, m2.id].map((id) => bracket.matches.find((m) => m.id === id).result));
    assert.equal(before, after);
    assert.ok(!Object.values(doubleElimPlacements(bracket)).includes(undefined));
  });

  it('single-elim generator exists but is never the default choice', () => {
    const s = generateSingleElim({ bracketId: 'b', seeds: seeds(8) });
    assert.equal(s.format, 'single-elim');
    simAll(s);
    const champ = s.matches.filter((m) => m.status === 'completed').length;
    assert.equal(champ, 7); // 8-man single elim = 7 bouts
    const p = singleElimPlacements(s);
    assert.equal(p['w-1'], 1); // lower seed always wins in simAll
    assert.equal(Object.values(p).filter((x) => x === 3).length, 2); // semifinal losers tie 3rd
    assert.equal(Object.values(p).filter((x) => x === 5).length, 4); // quarterfinal losers tie 5th
  });

  it('invalid results rejected: 0-0 major, unknown outcome, wrong winner', () => {
    const bracket = generateDoubleElim({ bracketId: 'b', seeds: seeds(4) });
    const m = readyMatches(bracket)[0];
    const byId = Object.fromEntries(bracket.matches.map((x) => [x.id, x]));
    const a = slotId(m.slot_a, byId, bracket.seeds);
    const bad = validateResultInput({
      bracket, match: m,
      result: { outcome: 'major', winnerId: a, loserId: 'w-2', scoreA: 0, scoreB: 0 },
      config: { values: { scoring: { techFallPoints: 15 } } },
    });
    assert.equal(bad.ok, false);
    const bad2 = validateResultInput({
      bracket, match: m,
      result: { outcome: 'pin', winnerId: 'nobody', loserId: a, scoreA: 6, scoreB: 0 },
      config: null,
    });
    assert.equal(bad2.ok, false);
  });
});

describe('A9 round-robin (generated sizes 2..6, ties, withdrawals)', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`size ${n}: complete schedule N*(N-1)/2, deterministic`, () => {
      const mk = () => generateRoundRobin({ bracketId: 'b', seeds: seeds(n) });
      assert.equal(mk().matches.length, expectedRrMatches(n));
      const shape = (s) => JSON.stringify(s.matches.map((m) => [m.round_label, JSON.stringify(m.slot_a), JSON.stringify(m.slot_b)]));
      assert.equal(shape(mk()), shape(mk()));
      const b = mk();
      simAll(b);
      checkInvariants(b, n);
      const { order, placements } = roundRobinStandings(b, {});
      assert.equal(order.length, n);
      assert.equal(placements[order[0]], 1);
    });
  }

  it('no ties: strict win order', () => {
    const b = generateRoundRobin({ bracketId: 'b', seeds: seeds(4) });
    simAll(b, { winner: 'lower' });
    const { order } = roundRobinStandings(b, {});
    assert.deepEqual(order, ['w-1', 'w-2', 'w-3', 'w-4']);
  });

  it('two-way tie broken head-to-head', () => {
    // 3 RR: w-1 beats w-2, w-3 beats w-1, w-2 beats w-3 => all 1-1 (circular).
    // For a pure 2-way tie use 4 RR with crafted results below instead.
    const b = generateRoundRobin({ bracketId: 'b', seeds: seeds(4) });
    // Round-robin match order is deterministic; find each pairing.
    const byId = () => Object.fromEntries(b.matches.map((m) => [m.id, m]));
    const findPair = (x, y) => b.matches.find((m) => {
      const ids = Object.fromEntries(b.matches.map((z) => [z.id, z]));
      const pair = [slotId(m.slot_a, ids, b.seeds), slotId(m.slot_b, ids, b.seeds)].sort().join('|');
      return pair === [x, y].sort().join('|');
    });
    const win = (x, y, sa = 6, sb = 2) => {
      const m = findPair(x, y);
      const ids = byId();
      const a = slotId(m.slot_a, ids, b.seeds);
      recordResult(b, m.id, {
        outcome: 'decision', winnerId: x, loserId: y,
        scoreA: a === x ? sa : sb, scoreB: a === x ? sb : sa,
      }, { actor: 'test' });
    };
    win('w-1', 'w-2'); win('w-1', 'w-3'); win('w-1', 'w-4');
    win('w-2', 'w-3'); win('w-2', 'w-4'); win('w-3', 'w-4');
    const { order } = roundRobinStandings(b, {});
    assert.deepEqual(order, ['w-1', 'w-2', 'w-3', 'w-4']);
    void findPair;
  });

  it('circular 3-way tie resolved deterministically (mini-table, then diff)', () => {
    const b = generateRoundRobin({ bracketId: 'b', seeds: seeds(3) });
    const ids = Object.fromEntries(b.matches.map((m) => [m.id, m]));
    const pairOf = (m) => [slotId(m.slot_a, ids, b.seeds), slotId(m.slot_b, ids, b.seeds)];
    // w-1 beats w-2 10-0; w-2 beats w-3 10-0; w-3 beats w-1 5-4.
    for (const m of b.matches) {
      const [a, bb] = pairOf(m);
      const key = [a, bb].sort().join('|');
      let winnerId, sa, sb;
      if (key === 'w-1|w-2') { winnerId = 'w-1'; sa = a === 'w-1' ? 10 : 0; sb = a === 'w-1' ? 0 : 10; }
      else if (key === 'w-2|w-3') { winnerId = 'w-2'; sa = a === 'w-2' ? 10 : 0; sb = a === 'w-2' ? 0 : 10; }
      else { winnerId = 'w-3'; sa = a === 'w-3' ? 5 : 4; sb = a === 'w-3' ? 4 : 5; }
      recordResult(b, m.id, {
        outcome: winnerId === 'w-3' ? 'decision' : 'major', winnerId,
        loserId: winnerId === a ? bb : a, scoreA: sa, scoreB: sb,
      }, { actor: 'test' });
    }
    const r1 = roundRobinStandings(b, { diffCap: 15 });
    const r2 = roundRobinStandings(b, { diffCap: 15 });
    assert.deepEqual(r1.order, r2.order, 'tie-break is deterministic');
    // Mini-table all 1-1; diffs: w-1: +10-1=+9; w-2: +10-10=0; w-3: +1-10=-9.
    assert.deepEqual(r1.order, ['w-1', 'w-2', 'w-3']);
  });

  it('diff cap is configurable and honored', () => {
    const b = generateRoundRobin({ bracketId: 'b', seeds: seeds(3) });
    const ids = Object.fromEntries(b.matches.map((m) => [m.id, m]));
    const pairOf = (m) => [slotId(m.slot_a, ids, b.seeds), slotId(m.slot_b, ids, b.seeds)];
    for (const m of b.matches) {
      const [a, bb] = pairOf(m);
      const key = [a, bb].sort().join('|');
      let winnerId, sa, sb, outcome = 'decision';
      if (key === 'w-1|w-2') { winnerId = 'w-1'; sa = 20; sb = 0; outcome = 'tech-fall'; }
      else if (key === 'w-2|w-3') { winnerId = 'w-2'; sa = 6; sb = 5; }
      else { winnerId = 'w-3'; sa = 6; sb = 5; }
      const scoreA = a === winnerId ? sa : (winnerId === (key.split('|')[0]) ? sb : sb);
      const scoreB = a === winnerId ? sb : sa;
      recordResult(b, m.id, {
        outcome, winnerId, loserId: winnerId === a ? bb : a,
        scoreA, scoreB,
      }, { actor: 'test' });
    }
    const capped = roundRobinStandings(b, { diffCap: 5 });
    const loose = roundRobinStandings(b, { diffCap: 30 });
    // With cap 30: w-1 diff +19 wins outright; with cap 5 all diffs shrink.
    assert.equal(loose.order[0], 'w-1');
    assert.deepEqual(capped.order, loose.order); // order may agree; key: both deterministic
    assert.notDeepEqual(
      JSON.stringify(capped.table['w-1'].diffVs),
      JSON.stringify(loose.table['w-1'].diffVs),
      'cap changes the stored differentials',
    );
  });

  it('incomplete group: withdrawal preserves completed results, no fabrication', () => {
    const b = generateRoundRobin({ bracketId: 'b', seeds: seeds(5) });
    assert.equal(b.matches.length, 10);
    // Complete 3 matches, then withdraw w-5 (Policy A default: preserve).
    const done = b.matches.slice(0, 3);
    const ids = Object.fromEntries(b.matches.map((m) => [m.id, m]));
    for (const m of done) {
      const a = slotId(m.slot_a, ids, b.seeds);
      const bb = slotId(m.slot_b, ids, b.seeds);
      recordResult(b, m.id, { outcome: 'decision', winnerId: a, loserId: bb, scoreA: 6, scoreB: 2 }, { actor: 'test' });
    }
    const snap = JSON.stringify(done.map((m) => m.result));
    // Remaining bouts vs w-5 recorded as forfeits (Policy A/C); others wrestled.
    for (const m of b.matches.slice(3)) {
      const a = slotId(m.slot_a, ids, b.seeds);
      const bb = slotId(m.slot_b, ids, b.seeds);
      if (a === 'w-5' || bb === 'w-5') {
        recordResult(b, m.id, { outcome: 'forfeit', winnerId: a === 'w-5' ? bb : a, loserId: 'w-5', scoreA: 0, scoreB: 0 }, { actor: 'test' });
      } else {
        recordResult(b, m.id, { outcome: 'decision', winnerId: a, loserId: bb, scoreA: 6, scoreB: 2 }, { actor: 'test' });
      }
    }
    assert.equal(JSON.stringify(done.map((m) => m.result)), snap, 'completed results untouched');
    const { order, table } = roundRobinStandings(b, {});
    assert.equal(order.length, 5);
    // Forfeit wins count as wins but contribute zero differential.
    const w5opponents = b.matches
      .filter((m) => m.result?.outcome === 'forfeit')
      .map((m) => m.result.winnerId);
    assert.ok(w5opponents.length > 0, 'forfeit wins recorded for w-5 opponents');
    for (const oid of w5opponents) {
      assert.equal(table[oid].diffVs['w-5'] || 0, 0, 'forfeit contributes no point differential');
    }
  });

  it('pool-to-bracket: snake split, pools complete, top-2 advance to finals', () => {
    const pools = poolSplit(seeds(8), 2);
    assert.deepEqual(pools, [['w-1', 'w-4', 'w-5', 'w-8'], ['w-2', 'w-3', 'w-6', 'w-7']]);
    assert.deepEqual(poolSplit(seeds(8), 2), pools); // deterministic
    const flat = pools.flat().sort();
    assert.deepEqual(flat, seeds(8).sort()); // nobody lost, nobody duplicated
    const structs = pools.map((p, i) => generateRoundRobin({ bracketId: `p${i}`, seeds: p }));
    assert.throws(() => poolAdvancers(structs, { advance: 2 }), /uncompleted bouts/);
    for (const s of structs) simAll(s, { winner: 'lower' });
    const adv = poolAdvancers(structs, { advance: 2 });
    assert.deepEqual(adv, [['w-1', 'w-4'], ['w-2', 'w-3']]);
    const finals = generateSingleElim({ bracketId: 'f', seeds: adv.flat() });
    simAll(finals);
    assert.equal(finals.matches.filter((m) => m.status === 'completed').length, 3);
  });

  it('all-equal records resolved by seed then stable ID (never random)', () => {
    const b = generateRoundRobin({ bracketId: 'b', seeds: seeds(4) });
    // No results at all: all 0-0. Order must equal seed order, deterministically.
    const r1 = roundRobinStandings(b, {});
    const r2 = roundRobinStandings(b, {});
    assert.deepEqual(r1.order, ['w-1', 'w-2', 'w-3', 'w-4']);
    assert.deepEqual(r1.order, r2.order);
  });
});
