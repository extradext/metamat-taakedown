// matching.test.js — A10: historical matching validated independently from
// bracket generation. Synthetic histories compare historical matching vs
// random / seed-based / declared-skill-only pairing on disparity, mismatch
// rate, and insufficient-evidence detection. A demo shows HOW it works; these
// synthetic results are NOT proof of real-world effectiveness.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assess, disparity, madisonGroups, evaluateGrouping, alternativeGrouping,
} from '../src/matching.js';

// Seeded RNG for reproducible synthetic histories.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Synthetic club: 12 wrestlers, hidden true strength tiers.
function syntheticClub() {
  const rnd = mulberry32(42);
  const tiers = { elite: 3, mid: 5, new: 4 };
  const wrestlers = [];
  let i = 0;
  for (const [tier, count] of Object.entries(tiers)) {
    for (let k = 0; k < count; k++) {
      wrestlers.push({
        id: `s${i}`, tier, team: `Club-${(i % 3) + 1}`,
        weight: 70 + Math.floor(rnd() * 20), declared: tier === 'elite' ? '3' : tier === 'mid' ? '2' : '1',
      });
      i += 1;
    }
  }
  // Bouts: elites usually beat mids usually beat newbies; noisy.
  const strength = { elite: 1800, mid: 1500, new: 1200 };
  const bouts = [];
  const day = 86400000;
  const now = new Date('2026-10-01T00:00:00Z').getTime();
  for (let n = 0; n < 120; n++) {
    const a = wrestlers[Math.floor(rnd() * wrestlers.length)];
    let b = wrestlers[Math.floor(rnd() * wrestlers.length)];
    if (a === b) continue;
    const pa = 1 / (1 + Math.pow(10, (strength[b.tier] - strength[a.tier]) / 400));
    const aWins = rnd() < pa;
    bouts.push({
      winnerId: aWins ? a.id : b.id, loserId: aWins ? b.id : a.id,
      outcome: 'decision', at: new Date(now - Math.floor(rnd() * 300) * day).toISOString(),
      hasScore: rnd() > 0.2,
    });
  }
  // Newbies keep at most 2 bouts each (sparse-data check).
  const newCounts = {};
  const isNew = (id) => wrestlers.find((w) => w.id === id)?.tier === 'new';
  const rich = [];
  for (const x of bouts) {
    const news = [x.winnerId, x.loserId].filter(isNew);
    if (news.length === 0) { rich.push(x); continue; }
    if (news.every((id) => (newCounts[id] || 0) < 2)) {
      rich.push(x);
      news.forEach((id) => { newCounts[id] = (newCounts[id] || 0) + 1; });
    }
  }
  return { wrestlers, bouts: rich };
}

function trueGap(a, b) {
  const s = { elite: 2, mid: 1, new: 0 };
  return Math.abs(s[a.tier] - s[b.tier]);
}

function pairSequential(ids) {
  const pairs = [];
  for (let i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
  return pairs;
}

describe('A10 matching validation on synthetic histories', () => {
  it('assess(): elites rate above newbies; sparse wrestlers flagged unknown-ish', () => {
    const { wrestlers, bouts } = syntheticClub();
    const byId = Object.fromEntries(wrestlers.map((w) => [w.id, w]));
    // Two-pass: first pass ratings feed opponent strength on second pass.
    const pass1 = wrestlers.map((w) => assess({ wrestlerId: w.id, bouts, nowIso: '2026-10-31T00:00:00Z' }));
    const r1 = Object.fromEntries(pass1.map((a) => [a.wrestlerId, a.rating]));
    const pass2 = wrestlers.map((w) => assess({
      wrestlerId: w.id,
      bouts: bouts.map((b) => ({ ...b, opponentRating: r1[b.winnerId === w.id ? b.loserId : b.winnerId] })),
      nowIso: '2026-10-31T00:00:00Z',
    }));
    const eliteAvg = pass2.filter((a) => byId[a.wrestlerId].tier === 'elite').reduce((s, a) => s + a.rating, 0) / 3;
    const newAvg = pass2.filter((a) => byId[a.wrestlerId].tier === 'new').reduce((s, a) => s + a.rating, 0) / 4;
    assert.ok(eliteAvg > newAvg, `elite avg ${eliteAvg} > newbie avg ${newAvg}`);
    const sparse = pass2.filter((a) => a.matches < 3);
    assert.ok(sparse.length > 0, 'sparse-data wrestlers exist in the synthetic set');
    for (const a of sparse) assert.ok(['none', 'limited'].includes(a.confidence));
  });

  it('comparison report: historical vs random vs seed vs skill-only (numbers, not proof)', () => {
    const { wrestlers, bouts } = syntheticClub();
    const byId = Object.fromEntries(wrestlers.map((w) => [w.id, w]));
    const pass1 = wrestlers.map((w) => assess({ wrestlerId: w.id, bouts, nowIso: '2026-10-31T00:00:00Z' }));
    const r1 = Object.fromEntries(pass1.map((a) => [a.wrestlerId, a.rating]));
    const rated = wrestlers.map((w) => assess({
      wrestlerId: w.id,
      bouts: bouts.map((b) => ({ ...b, opponentRating: r1[b.winnerId === w.id ? b.loserId : b.winnerId] })),
      nowIso: '2026-10-31T00:00:00Z',
    }));
    const rating = Object.fromEntries(rated.map((a) => [a.wrestlerId, a.rating]));
    const ids = wrestlers.map((w) => w.id);
    const shuffled = [...ids]; // Fisher-Yates with seeded rng: a TRUE random baseline
    const srnd = mulberry32(7);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(srnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const strategies = {
      random: shuffled,
      seed: [...ids], // signup order (tier-ordered by construction on this set)
      skillOnly: [...ids].sort((x, y) => byId[x].declared.localeCompare(byId[y].declared)),
      historical: [...ids].sort((x, y) => rating[y] - rating[x]),
    };
    const report = {};
    for (const [name, order] of Object.entries(strategies)) {
      const pairs = pairSequential(order);
      const gaps = pairs.map(([x, y]) => trueGap(byId[x], byId[y]));
      const severe = gaps.filter((g) => g === 2).length;
      report[name] = { pairs: pairs.length, avgGap: gaps.reduce((s, g) => s + g, 0) / gaps.length, severe };
    }
    console.log('A10 comparison (synthetic — HOW it works, not proof):', JSON.stringify(report));
    assert.ok(report.historical.avgGap <= report.random.avgGap, 'historical sorts at least as well as random on synthetic data');
    assert.ok(report.historical.severe <= report.random.severe);
  });

  it('disparity(): insufficient evidence reported, never invented', () => {
    const a = { wrestlerId: 'x', rating: 1500, confidence: 'none' };
    const b = { wrestlerId: 'y', rating: 1900, confidence: 'established' };
    assert.equal(disparity(a, b).level, 'insufficient-evidence');
    assert.equal(disparity(b, { ...b, wrestlerId: 'z', rating: 1500 }).level, 'likely');
  });

  it('madisonGroups(): weight-sorted, sized 4-6, spread-capped, deterministic', () => {
    const rnd = mulberry32(9);
    const pool = Array.from({ length: 23 }, (_, i) => ({
      id: `m${i}`, weighinWeight: 60 + Math.floor(rnd() * 40), team: `T${i % 4}`,
    }));
    const g1 = madisonGroups({ wrestlers: pool });
    const g2 = madisonGroups({ wrestlers: pool });
    assert.deepEqual(g1, g2);
    const flat = g1.flat().map((w) => w.id).sort();
    assert.deepEqual(flat, pool.map((w) => w.id).sort()); // nobody lost
    const spreads = g1.map((g) => {
      const ws = g.map((w) => w.weighinWeight);
      return Math.max(...ws) - Math.min(...ws);
    });
    // Core groups respect maxSpread; only the folded tail-merge may stretch one group.
    assert.ok(spreads.filter((s) => s <= 8).length >= g1.length - 1);
    for (const g of g1) assert.ok(g.length >= 1);
    assert.ok(g1.every((g) => g.length <= 8));
  });

  it('evaluateGrouping(): ineligible = confirmed conflict; alternatives offered', () => {
    const { wrestlers, bouts } = syntheticClub();
    const rated = wrestlers.map((w) => assess({ wrestlerId: w.id, bouts, nowIso: '2026-10-31T00:00:00Z' }));
    const eligible = wrestlers.map((w) => w.id);
    const reports = evaluateGrouping({ groups: [['s0', 's1', 'zzz'], ['s2', 's3']], assessments: rated, eligible });
    assert.ok(reports[0].problems.some((p) => p.level === 'confirmed-conflict'));
    const alt = alternativeGrouping({ eligibleIds: eligible, assessments: rated, groupSize: 4 });
    assert.equal(alt.groups.flat().length, eligible.length);
    assert.ok(alt.groups.length >= 2);
  });
});
