// engine.js — Deterministic bracket engines. No AI, no randomness, no wall
// clock. Same inputs => same outputs, always. AI never decides brackets.
// Outcome codes stay distinct: bye creates NO match record (A7.2); forfeit /
// medical-forfeit / default / injury-default / dq / no-show each advance,
// score, and rate differently.
import { newId } from './ids.js';

export const WRESTLED_OUTCOMES = ['pin', 'tech-fall', 'major', 'decision'];
export const ADMIN_OUTCOMES = [
  'forfeit', 'medical-forfeit', 'default', 'injury-default', 'dq', 'no-show',
];
export const ALL_OUTCOMES = [...WRESTLED_OUTCOMES, ...ADMIN_OUTCOMES];

/** Performance-evidence weight for ratings: most admin outcomes carry none. */
export function evidenceWeight(outcome) {
  if (WRESTLED_OUTCOMES.includes(outcome)) return 1;
  if (outcome === 'default') return 0.25;
  return 0;
}

/** Does this outcome count as a bout actually wrestled (bout cap)? */
export function countsAsWrestled(outcome) {
  return WRESTLED_OUTCOMES.includes(outcome) || outcome === 'injury-default' || outcome === 'dq';
}

// ---------- slot refs ----------
// {t:'seed', i} | {t:'w', m} winner of match | {t:'l', m} loser of match |
// {t:'wrestler', id} resolved concrete | {t:'empty'} (withdrawn hole)
export function resolveSlot(ref, matchesById) {
  if (!ref) return null;
  if (ref.t === 'wrestler') return ref.id;
  if (ref.t === 'seed') return { seedIndex: ref.i };
  if (ref.t === 'empty') return null;
  const m = matchesById[ref.m];
  if (!m || !m.result) return null;
  return ref.t === 'w' ? m.result.winnerId : m.result.loserId;
}

/** Resolve a slot to a concrete wrestler id (or null if TBD/empty). */
export function resolveWrestler(ref, matchesById, seeds) {
  const r = resolveSlot(ref, matchesById);
  if (r && typeof r === 'object' && 'seedIndex' in r) return seeds[r.seedIndex] ?? null;
  return r;
}

function mkMatch({ bracketId, round, side, a, b, label }) {
  return {
    id: newId(), bracket_id: bracketId, round_label: label || `${side}-${round}`,
    bracket_side: side, slot_a: a, slot_b: b, status: 'pending',
    live_score: null, result: null, ended_at: null, scored_by: null,
    mat: null, bout_number: null,
  };
}

function nextPow2(n) { let s = 1; while (s < n) s *= 2; return s; }

/** Standard seed placement order for a power-of-2 winners bracket. */
export function seedOrder(size) {
  let order = [0, 1];
  while (order.length < size) {
    const next = [];
    for (const x of order) { next.push(x); next.push(order.length * 2 - 1 - x); }
    order = next;
  }
  return order;
}

// ---------- single elimination (available, NEVER the default) ----------
export function generateSingleElim({ bracketId, seeds }) {
  const n = seeds.length;
  if (n < 2) throw new Error('need at least 2 wrestlers');
  const size = nextPow2(n);
  const order = seedOrder(size);
  const matches = [];
  // Round 1: pair in seed order; byes advance with NO match record.
  let current = [];
  for (let i = 0; i < size; i += 2) {
    const a = order[i] < n ? { t: 'seed', i: order[i] } : null;
    const b = order[i + 1] < n ? { t: 'seed', i: order[i + 1] } : null;
    if (a && b) {
      const m = mkMatch({ bracketId, round: 1, side: 'WB', a, b });
      matches.push(m); current.push({ t: 'w', m: m.id });
    } else if (a || b) {
      current.push(a || b); // bye: no match record, no win, no rating effect
    }
  }
  let round = 2;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i]; const b = current[i + 1];
      if (a && b) {
        const m = mkMatch({ bracketId, round, side: 'WB', a, b });
        matches.push(m); next.push({ t: 'w', m: m.id });
      } else next.push(a || b);
    }
    current = next; round += 1;
  }
  return { format: 'single-elim', seeds: [...seeds], matches, championRef: current[0], placements: {} };
}

// ---------- double elimination (the standard; genuine, not WB+loose consol) ----------
export function generateDoubleElim({ bracketId, seeds, consolationChallenge = true }) {
  const n = seeds.length;
  if (n < 2) throw new Error('need at least 2 wrestlers');
  if (n === 2) return generateTwoMan({ bracketId, seeds, consolationChallenge });
  const size = nextPow2(n);
  const order = seedOrder(size);
  const matches = [];
  const wbRounds = []; // wbRounds[r] = matches in winners round r (0-based)

  // Winners R1 with byes (no match record for a bye).
  let current = [];
  const r1 = [];
  for (let i = 0; i < size; i += 2) {
    const a = order[i] < n ? { t: 'seed', i: order[i] } : null;
    const b = order[i + 1] < n ? { t: 'seed', i: order[i + 1] } : null;
    if (a && b) {
      const m = mkMatch({ bracketId, round: 1, side: 'WB', a, b });
      matches.push(m); r1.push(m); current.push({ t: 'w', m: m.id });
    } else if (a || b) current.push(a || b);
  }
  wbRounds.push(r1);
  let round = 2;
  while (current.length > 1) {
    const rm = []; const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const m = mkMatch({ bracketId, round, side: 'WB', a: current[i], b: current[i + 1] });
      matches.push(m); rm.push(m); next.push({ t: 'w', m: m.id });
    }
    wbRounds.push(rm); current = next; round += 1;
  }
  const wbChampRef = current[0];
  const w = wbRounds.length;

  // Pair slots into consol matches; odd leftover carries forward (bye, no record).
  let consolRound = 1;
  const pairRound = (slots) => {
    const out = [];
    for (let i = 0; i < slots.length; i += 2) {
      if (i + 1 < slots.length) {
        const m = mkMatch({ bracketId, round: consolRound, side: 'CONS', a: slots[i], b: slots[i + 1] });
        matches.push(m); out.push({ t: 'w', m: m.id });
      } else out.push(slots[i]);
    }
    consolRound += 1;
    return out;
  };
  const zipWith = (slots, newcomers) => {
    // Winners of previous consol play the newly-dropped WB losers, in order.
    if (slots.length === 0) return pairRound(newcomers);
    const maxLen = Math.max(slots.length, newcomers.length);
    const paired = []; const carry = [];
    for (let i = 0; i < maxLen; i++) {
      const s = slots[i]; const v = newcomers[i];
      if (s && v) {
        const m = mkMatch({ bracketId, round: consolRound, side: 'CONS', a: s, b: v });
        matches.push(m); paired.push({ t: 'w', m: m.id });
      } else carry.push(s || v);
    }
    consolRound += 1;
    return [...paired, ...carry];
  };

  let slots = pairRound(wbRounds[0].map((m) => ({ t: 'l', m: m.id })));
  for (let k = 1; k < w; k++) {
    slots = zipWith(slots, wbRounds[k].map((m) => ({ t: 'l', m: m.id })));
    if (k < w - 1) slots = pairRound(slots);
  }
  while (slots.length > 1) slots = pairRound(slots);
  const consolChampRef = slots[0];

  if (consolationChallenge) {
    const fin = mkMatch({ bracketId, round: 1, side: 'FINAL', a: wbChampRef, b: consolChampRef, label: 'CHAMPIONSHIP FINAL' });
    matches.push(fin);
    return { format: 'double-elim', seeds: [...seeds], matches, finalId: fin.id, resetId: null, placements: {} };
  }
  // Single-final variant: WB final = 1st/2nd, consol final = 3rd/4th.
  const consolFinal = mkMatch({ bracketId, round: consolRound, side: 'PLACE3', a: consolChampRef, b: { t: 'empty' }, label: '3RD PLACE' });
  // NOTE: PLACE3 needs two refs; consolChampRef is the survivor; the second
  // finalist is whoever the survivor beat last — instead we rebuild below.
  matches.pop(); // drop placeholder; real 3rd-place match built by caller path
  void consolFinal;
  return buildSingleFinal({ bracketId, seeds, matches, wbRounds, wbChampRef, consolChampRef });
}

function generateTwoMan({ bracketId, seeds }) {
  const m = mkMatch({ bracketId, round: 1, side: 'FINAL', a: { t: 'seed', i: 0 }, b: { t: 'seed', i: 1 }, label: 'CHAMPIONSHIP FINAL' });
  return { format: 'double-elim', seeds: [...seeds], matches: [m], finalId: m.id, resetId: null, placements: {} };
}

function buildSingleFinal({ bracketId, seeds, matches, wbRounds, wbChampRef, consolChampRef }) {
  // In single-final mode the last consol match produced consolChampRef; find
  // its match to recover the runner-up as the other 3rd-place finalist.
  const lastConsol = [...matches].reverse().find((m) => m.bracket_side === 'CONS');
  let thirdA = consolChampRef; let thirdB = { t: 'empty' };
  if (lastConsol) {
    thirdA = lastConsol.slot_a; thirdB = lastConsol.slot_b;
    // Remove the old consol-final: it becomes the 3rd-place match itself.
    lastConsol.bracket_side = 'PLACE3';
    lastConsol.round_label = '3RD PLACE';
  }
  void thirdA; void thirdB;
  return { format: 'double-elim-single-final', seeds: [...seeds], matches, finalId: wbRounds[wbRounds.length - 1][0].id, resetId: null, placements: {} };
}

/** Grand-final reset (R5: ONLY when the ruleset explicitly enables it). */
export function maybeCreateReset(struct, { resetEnabled }) {
  if (!resetEnabled || struct.resetId || !struct.finalId) return null;
  const fin = struct.matches.find((m) => m.id === struct.finalId);
  if (!fin || !fin.result) return null;
  const byId = Object.fromEntries(struct.matches.map((m) => [m.id, m]));
  const wbChamp = resolveWrestler(fin.slot_a, byId, struct.seeds);
  if (fin.result.winnerId !== wbChamp) {
    const reset = mkMatch({ bracketId: fin.bracket_id, round: 2, side: 'RESET', a: { t: 'wrestler', id: fin.result.winnerId }, b: { t: 'wrestler', id: fin.result.loserId }, label: 'CHAMPIONSHIP RESET' });
    struct.matches.push(reset);
    struct.resetId = reset.id;
    return reset;
  }
  return null;
}

// ---------- round robin (separate strategy, never relabelled single-elim) ----------
export function expectedRrMatches(n) { return (n * (n - 1)) / 2; }

export function generateRoundRobin({ bracketId, seeds }) {
  const n = seeds.length;
  if (n < 2) throw new Error('need at least 2 wrestlers');
  const ids = seeds.map((_, i) => i);
  if (n % 2 === 1) ids.push(null); // rotating bye; never a win
  const rounds = ids.length - 1;
  const matches = [];
  const arr = [...ids];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < arr.length / 2; i++) {
      const a = arr[i]; const b = arr[arr.length - 1 - i];
      if (a === null || b === null) continue; // bye round for one wrestler
      matches.push(mkMatch({ bracketId, round: r + 1, side: 'RR', a: { t: 'seed', i: a }, b: { t: 'seed', i: b }, label: `RR ROUND ${r + 1}` }));
    }
    arr.splice(1, 0, arr.pop());
  }
  return { format: 'round-robin', seeds: [...seeds], matches, placements: {} };
}

// ---------- pool-to-bracket support: snake split + finals from standings ----------
// Pools are round-robins (tested engine); finals are built AFTER pools complete
// from verified standings — two deterministic steps, organizer-approved.
export function poolSplit(seeds, numPools = 2) {
  if (numPools < 2) throw new Error('pool-to-bracket needs at least 2 pools');
  const pools = Array.from({ length: numPools }, () => []);
  seeds.forEach((s, i) => {
    const round = Math.floor(i / numPools);
    const idx = round % 2 === 0 ? i % numPools : numPools - 1 - (i % numPools);
    pools[idx].push(s);
  });
  return pools.filter((p) => p.length > 0);
}

/** Top-N advancers per pool, in order. Throws unless every pool bout is complete. */
export function poolAdvancers(poolStructs, { advance = 2, diffCap = 15 } = {}) {
  return poolStructs.map((struct) => {
    const pending = struct.matches.filter((m) => m.status !== 'completed');
    if (pending.length) throw new Error(`pool has ${pending.length} uncompleted bouts — finals wait for results`);
    const { order } = roundRobinStandings(struct, { diffCap });
    return order.slice(0, advance);
  });
}

// ---------- results, advancement, placements ----------
export function validateResultInput({ bracket, match, result, config }) {
  const errors = [];
  if (!ALL_OUTCOMES.includes(result.outcome)) errors.push(`unknown outcome: ${result.outcome}`);
  if (match.status === 'completed') errors.push('match already completed; use the correction workflow');
  if (result.outcome === 'major' && result.scoreA === 0 && result.scoreB === 0) {
    errors.push('a Completed bout cannot be 0-0 with outcome "major"');
  }
  const byId = Object.fromEntries(bracket.matches.map((m) => [m.id, m]));
  const a = resolveWrestler(match.slot_a, byId, bracket.seeds);
  const b = resolveWrestler(match.slot_b, byId, bracket.seeds);
  if (!a || !b) errors.push('both slots must resolve before recording a result');
  if (a && b && ![a, b].includes(result.winnerId)) errors.push('winner must be a wrestler in this bout');
  if (a && b && ![a, b].includes(result.loserId)) errors.push('loser must be a wrestler in this bout');
  if (result.winnerId === result.loserId) errors.push('winner and loser must differ');
  if (config && WRESTLED_OUTCOMES.includes(result.outcome)) {
    const t = config.values.scoring || {};
    if (result.outcome === 'major') {
      const diff = Math.abs((result.scoreA ?? 0) - (result.scoreB ?? 0));
      if (!(diff >= 8 && diff <= 14)) errors.push(`major decision margin must be 8-14 (got ${diff})`);
    }
    if (result.outcome === 'tech-fall') {
      const diff = Math.abs((result.scoreA ?? 0) - (result.scoreB ?? 0));
      if (diff < (t.techFallPoints ?? 15)) errors.push(`tech fall margin must reach ${t.techFallPoints ?? 15} (got ${diff})`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function recordResult(bracket, matchId, result, { actor = 'table', at = null } = {}) {
  const match = bracket.matches.find((m) => m.id === matchId);
  if (!match) throw new Error('match not found');
  match.result = { ...result };
  match.status = 'completed';
  match.ended_at = at || new Date().toISOString();
  match.scored_by = actor;
  match.live_score = null;
  return match;
}

/** Matches ready to wrestle: both slots resolve, still pending. */
export function readyMatches(bracket) {
  const byId = Object.fromEntries(bracket.matches.map((m) => [m.id, m]));
  return bracket.matches.filter((m) => {
    if (m.status !== 'pending') return false;
    return resolveWrestler(m.slot_a, byId, bracket.seeds) && resolveWrestler(m.slot_b, byId, bracket.seeds);
  });
}

/** Count losses per wrestler from completed matches (elimination check). */
export function lossCounts(bracket) {
  const counts = {};
  for (const m of bracket.matches) {
    if (m.status === 'completed' && m.result) {
      counts[m.result.loserId] = (counts[m.result.loserId] || 0) + 1;
    }
  }
  return counts;
}

/** Double-elim placements: 1/2 from final (or reset); 3rd = consol-final
 *  loser; deeper places ordered by fewest losses then latest round reached. */
export function doubleElimPlacements(struct) {
  const byId = Object.fromEntries(struct.matches.map((m) => [m.id, m]));
  const decide = struct.resetId
    ? struct.matches.find((m) => m.id === struct.resetId)
    : struct.matches.find((m) => m.id === struct.finalId);
  const placements = {};
  if (struct.format === 'double-elim-single-final') {
    const fin = struct.matches.find((m) => m.id === struct.finalId);
    const p3 = struct.matches.find((m) => m.bracket_side === 'PLACE3');
    if (fin?.result) { placements[fin.result.winnerId] = 1; placements[fin.result.loserId] = 2; }
    if (p3?.result) { placements[p3.result.winnerId] = 3; placements[p3.result.loserId] = 4; }
  } else if (decide?.result) {
    placements[decide.result.winnerId] = 1;
    placements[decide.result.loserId] = 2;
    const consolMatches = struct.matches.filter((m) => m.bracket_side === 'CONS');
    // Consol-final loser = the loser of the latest completed CONS match whose
    // winner reached the championship final.
    const finalists = new Set([decide.result.winnerId, decide.result.loserId]);
    const consolFinal = [...consolMatches].reverse().find((m) => m.result && finalists.has(m.result.winnerId));
    if (consolFinal) placements[consolFinal.result.loserId] = 3;
  }
  // Everyone else: fewer losses first, then later elimination round, then seed.
  const losses = lossCounts(struct);
  const lastRound = {};
  for (const m of struct.matches) {
    if (!m.result) continue;
    const r = roundRank(m);
    for (const id of [m.result.winnerId, m.result.loserId]) {
      lastRound[id] = Math.max(lastRound[id] || 0, r);
    }
  }
  const rest = struct.seeds.filter((id) => !(id in placements)).sort((x, y) => {
    const lx = losses[x] || 0; const ly = losses[y] || 0;
    if (lx !== ly) return lx - ly;
    if ((lastRound[y] || 0) !== (lastRound[x] || 0)) return (lastRound[y] || 0) - (lastRound[x] || 0);
    return struct.seeds.indexOf(x) - struct.seeds.indexOf(y);
  });
  let place = Math.max(0, ...Object.values(placements)) + 1;
  for (const id of rest) placements[id] = place++;
  return placements;
}

/** Single-elim placements: 1/2 from the final; earlier exits share place
 *  bands by elimination round (semifinal losers tie 3rd, etc.). */
export function singleElimPlacements(struct) {
  const done = struct.matches.filter((m) => m.status === 'completed' && m.result);
  const placements = {};
  if (!done.length) return placements;
  const last = done[done.length - 1];
  placements[last.result.winnerId] = 1;
  placements[last.result.loserId] = 2;
  const elimRound = {};
  for (const m of done) {
    if (m === last) continue;
    elimRound[m.result.loserId] = roundRank(m);
  }
  const rounds = [...new Set(Object.values(elimRound))].sort((x, y) => y - x);
  let place = 3;
  for (const r of rounds) {
    const ids = Object.keys(elimRound).filter((id) => elimRound[id] === r);
    for (const id of ids) placements[id] = place;
    place += ids.length;
  }
  return placements;
}

function roundRank(m) {
  const n = parseInt(String(m.round_label).replace(/[^0-9]/g, ''), 10);
  const sideBonus = m.bracket_side === 'FINAL' || m.bracket_side === 'RESET' ? 100 : m.bracket_side === 'CONS' ? 50 : 0;
  return sideBonus + (Number.isFinite(n) ? n : 0);
}

// ---------- round-robin standings (§8.2 sequence, ruleset may override) ----------
export function roundRobinStandings(struct, { diffCap = 15, seedNames = null } = {}) {
  const table = {};
  for (const id of struct.seeds) {
    table[id] = { id, wins: 0, losses: 0, h2h: {}, diffVs: {}, allowedVs: {}, seed: struct.seeds.indexOf(id) };
  }
  for (const m of struct.matches) {
    if (m.status !== 'completed' || !m.result) continue;
    const { winnerId: w, loserId: l, outcome, scoreA = 0, scoreB = 0 } = m.result;
    if (!table[w] || !table[l]) continue;
    table[w].wins += 1; table[l].losses += 1;
    table[w].h2h[l] = (table[w].h2h[l] || 0) + 1;
    // Point differential applies ONLY to wrestled outcomes.
    if (WRESTLED_OUTCOMES.includes(outcome)) {
      const byId = Object.fromEntries(struct.matches.map((x) => [x.id, x]));
      const a = resolveWrestler(m.slot_a, byId, struct.seeds);
      const wScore = w === a ? scoreA : scoreB;
      const lScore = w === a ? scoreB : scoreA;
      const diff = Math.min(diffCap, Math.max(-diffCap, wScore - lScore));
      table[w].diffVs[l] = (table[w].diffVs[l] || 0) + diff;
      table[l].diffVs[w] = (table[l].diffVs[w] || 0) - diff;
      table[w].allowedVs[l] = (table[w].allowedVs[l] || 0) + lScore;
      table[l].allowedVs[w] = (table[l].allowedVs[w] || 0) + wScore;
    }
  }
  const sumVs = (row, group, field) => group.reduce((s, id) => s + ((row[field][id]) || 0), 0);
  const miniWins = (row, group) => group.reduce((s, id) => s + (row.h2h[id] || 0), 0);

  // Group by wins, break ties inside each group.
  const groups = new Map();
  for (const id of struct.seeds) {
    const w = table[id].wins;
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(id);
  }
  const ordered = [];
  for (const wins of [...groups.keys()].sort((x, y) => y - x)) {
    const g = groups.get(wins);
    if (g.length === 1) { ordered.push(g[0]); continue; }
    if (g.length === 2) {
      const [x, y] = g;
      const xBeatY = (table[x].h2h[y] || 0) > (table[y].h2h[x] || 0);
      const yBeatX = (table[y].h2h[x] || 0) > (table[x].h2h[y] || 0);
      if (xBeatY && !yBeatX) ordered.push(x, y);
      else if (yBeatX && !xBeatY) ordered.push(y, x);
      else ordered.push(...breakByDiff(g, table, sumVs));
      continue;
    }
    // 3+: mini-table wins, then capped diff among tied, then fewest allowed
    // among tied, then original seed, then stable ID fallback.
    ordered.push(...[...g].sort((x, y) => {
      const mw = miniWins(table[y], g) - miniWins(table[x], g);
      if (mw !== 0) return mw;
      const d = sumVs(table[y], g, 'diffVs') - sumVs(table[x], g, 'diffVs');
      if (d !== 0) return d;
      const al = sumVs(table[x], g, 'allowedVs') - sumVs(table[y], g, 'allowedVs');
      if (al !== 0) return al;
      if (table[x].seed !== table[y].seed) return table[x].seed - table[y].seed;
      return String(x) < String(y) ? -1 : 1;
    }));
  }
  const placements = {};
  ordered.forEach((id, i) => { placements[id] = i + 1; });
  void seedNames;
  return { order: ordered, placements, table };
}

function breakByDiff(g, table, sumVs) {
  return [...g].sort((x, y) => {
    const d = sumVs(table[y], g, 'diffVs') - sumVs(table[x], g, 'diffVs');
    if (d !== 0) return d;
    const al = sumVs(table[x], g, 'allowedVs') - sumVs(table[y], g, 'allowedVs');
    if (al !== 0) return al;
    if (table[x].seed !== table[y].seed) return table[x].seed - table[y].seed;
    return String(x) < String(y) ? -1 : 1;
  });
}

// ---------- rest gate (measured from match END, floor from config) ----------
export function restStatus({ lastBoutEndIso, nowIso, restFloorMin }) {
  if (!lastBoutEndIso) return { state: 'clear', restedMin: Infinity, needsMin: 0, message: 'No matches yet today — clear to wrestle.' };
  const restedMin = Math.floor((new Date(nowIso) - new Date(lastBoutEndIso)) / 60000);
  if (restedMin >= restFloorMin) {
    return { state: 'clear', restedMin, needsMin: 0, message: `Rested ${restedMin} min (needs ${restFloorMin}) — clear.` };
  }
  return {
    state: 'held', restedMin, needsMin: restFloorMin - restedMin,
    message: `HELD — rest gate: wrestled ${restedMin} min ago, needs ${restFloorMin} min.`,
  };
}

/** Wrestler's most recent bout end across a tournament's matches. */
export function lastBoutEnd(matches, wrestlerId) {
  let latest = null;
  for (const m of matches) {
    if (!m.result || !m.ended_at) continue;
    if (m.result.winnerId === wrestlerId || m.result.loserId === wrestlerId) {
      if (!latest || m.ended_at > latest) latest = m.ended_at;
    }
  }
  return latest;
}

/** One decided-match predicate for every day total: completed AND carrying
 *  a result. Day stats, snapshots, and bracket rows all count this same set,
 *  so outcome buckets can never exceed completed matches. */
export function isDecided(m) {
  return !!m && m.status === 'completed' && !!m.result;
}

// ---------- bout cap (bouts actually wrestled; forfeits received excluded) ----------
export function boutsWrestled(matches, wrestlerId) {
  let n = 0;
  for (const m of matches) {
    if (m.status !== 'completed' || !m.result) continue;
    const r = m.result;
    const involved = r.winnerId === wrestlerId || r.loserId === wrestlerId;
    if (!involved) continue;
    if (countsAsWrestled(r.outcome)) n += 1;
  }
  return n;
}

// ---------- seeding contradiction flags (human review, never silent) ----------
export function seedingFlags({ seeds, history }) {
  // history: [{winnerId, loserId}] verified past bouts.
  const flags = [];
  const pos = Object.fromEntries(seeds.map((id, i) => [id, i]));
  const seen = new Set();
  for (const h of history) {
    if (!(h.winnerId in pos) || !(h.loserId in pos)) continue;
    if (pos[h.winnerId] > pos[h.loserId]) {
      const key = `${h.winnerId}>${h.loserId}`;
      if (!seen.has(key)) {
        seen.add(key);
        flags.push({
          type: 'head-to-head-contradiction',
          message: `Seed #${pos[h.winnerId] + 1} beat seed #${pos[h.loserId] + 1} head-to-head but is seeded below them. Human review needed.`,
          winnerId: h.winnerId, loserId: h.loserId,
        });
      }
    }
  }
  return flags;
}

// ---------- weigh-in / skin-check gate ----------
export function eligibility(reg) {
  if (!reg) return { eligible: false, reason: 'No registration for this tournament.' };
  if (reg.concussionLock) return { eligible: false, reason: 'Concussion lock — clearance required. No bout until clearance is recorded.' };
  if (reg.weighinWeight == null) return { eligible: false, reason: 'No weigh-in weight recorded.' };
  if (reg.skinCheck !== 'pass') return { eligible: false, reason: `Skin check is "${reg.skinCheck || 'pending'}" — a pass is required.` };
  return { eligible: true, reason: 'Weigh-in and skin-check pass recorded.' };
}
