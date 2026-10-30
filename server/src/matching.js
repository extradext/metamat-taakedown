// matching.js — Historical competitive matching (A3). Deterministic and
// reproducible: the statistical engine calculates, AI explains, the organizer
// decides. Ratings are organizer/coach-only (R6): never on a card, never
// public, never a score shown to parents/kids. Unknown ability is NEVER
// displayed as low ability.
import { evidenceWeight, WRESTLED_OUTCOMES } from './engine.js';

const BASE_RATING = 1500;
const MS_PER_DAY = 86400000;

/** Recency weight: older results gradually matter less (half-life ~1 year). */
export function recencyWeight(matchIso, nowIso) {
  const days = Math.max(0, (new Date(nowIso) - new Date(matchIso)) / MS_PER_DAY);
  return Math.pow(0.5, days / 365);
}

/**
 * Assess one wrestler from verified historical bouts.
 * bouts: [{winnerId, loserId, outcome, at, opponentRating, hasScore}] in
 * chronological order. Declared skill stays separate from demonstrated history.
 */
export function assess({ wrestlerId, bouts, nowIso = new Date().toISOString() }) {
  const mine = bouts.filter((b) => b.winnerId === wrestlerId || b.loserId === wrestlerId);
  const opponents = new Set();
  let rating = BASE_RATING;
  let counted = 0; let scored = 0; let lastAt = null;
  const limitations = [];
  for (const b of mine) {
    const w = evidenceWeight(b.outcome) * recencyWeight(b.at, nowIso);
    if (w <= 0) continue;
    const opp = b.winnerId === wrestlerId ? b.loserId : b.winnerId;
    opponents.add(opp);
    const oppR = b.opponentRating ?? BASE_RATING;
    const expected = 1 / (1 + Math.pow(10, (oppR - rating) / 400));
    const actual = b.winnerId === wrestlerId ? 1 : 0;
    const k = 32 / (1 + counted / 10); // early results move more, never conclusive alone
    rating += k * w * (actual - expected);
    counted += 1;
    if (b.hasScore) scored += 1;
    if (!lastAt || b.at > lastAt) lastAt = b.at;
  }
  const distinct = opponents.size;
  const recencyDays = lastAt ? (new Date(nowIso) - new Date(lastAt)) / MS_PER_DAY : Infinity;
  let confidence;
  if (counted === 0) confidence = 'none';
  else if (counted < 3 || distinct < 2) confidence = 'limited';
  else if (counted < 8 || distinct < 4) confidence = 'developing';
  else if (counted < 20) confidence = 'established';
  else confidence = 'strong';
  if (counted === 0) limitations.push('No meaningful historical evidence — treat as UNKNOWN ability, never as low ability.');
  if (counted > 0 && counted < 3) limitations.push('Very few recorded bouts — a single result is not conclusive.');
  if (distinct < 2 && counted > 0) limitations.push('Few distinct opponents — record may not generalize.');
  if (recencyDays > 365) limitations.push('Most recent recorded competition is over a year old.');
  if (scored < counted) limitations.push('Some records are outcome-only (no scores).');
  return {
    wrestlerId, rating: Math.round(rating * 10) / 10, confidence,
    matches: counted, distinctOpponents: distinct, lastCompetition: lastAt,
    limitations,
  };
}

export const CONFIDENCE_LABEL = {
  none: 'No meaningful historical evidence',
  limited: 'Limited evidence',
  developing: 'Developing evidence',
  established: 'Established evidence',
  strong: 'Strong historical evidence',
};

/** Pairwise disparity report between two assessments. */
export function disparity(a, b) {
  if (a.confidence === 'none' || b.confidence === 'none') {
    return { level: 'insufficient-evidence', gap: null, message: 'Insufficient historical evidence to compare — no claim made.' };
  }
  const gap = Math.abs(a.rating - b.rating);
  const weak = a.confidence === 'limited' || b.confidence === 'limited';
  if (gap >= 400) {
    return {
      level: weak ? 'possible-limited' : 'likely',
      gap,
      message: weak
        ? `Possible mismatch (rating gap ~${Math.round(gap)}) but evidence is limited — review carefully.`
        : `Likely competitive mismatch (rating gap ~${Math.round(gap)}). Consider an alternative grouping.`,
    };
  }
  if (gap >= 200) {
    return {
      level: weak ? 'insufficient-evidence' : 'possible-limited', gap,
      message: `Moderate gap (~${Math.round(gap)}). ${weak ? 'Evidence too thin to call it.' : 'Watch as a possible mismatch.'}`,
    };
  }
  return { level: 'ok', gap, message: `Competitive gap looks reasonable (~${Math.round(gap)}).` };
}

/**
 * Madison/block grouping: sort by actual weigh-in weight, build 4-6 wrestler
 * groups within maxSpread, separate teammates where possible. Deterministic.
 */
export function madisonGroups({ wrestlers, minSize = 4, maxSize = 6, maxSpread = 8 }) {
  // wrestlers: [{id, weighinWeight, team}]
  let pool = [...wrestlers].sort((x, y) => x.weighinWeight - y.weighinWeight);
  const groups = [];
  while (pool.length > 0) {
    const anchor = pool[0];
    const inSpread = pool.filter((w) => w.weighinWeight - anchor.weighinWeight <= maxSpread);
    // Different-team first (teammate separation when possible), then closest weight.
    inSpread.sort((x, y) =>
      ((x.team === anchor.team ? 1 : 0) - (y.team === anchor.team ? 1 : 0))
      || (Math.abs(x.weighinWeight - anchor.weighinWeight) - Math.abs(y.weighinWeight - anchor.weighinWeight)));
    const group = inSpread.slice(0, maxSize);
    groups.push(group);
    const used = new Set(group.map((g) => g.id));
    pool = pool.filter((w) => !used.has(w.id));
    if (groups.length > 1000) break; // safety; unreachable in practice
  }
  // Fold a trailing undersized group into earlier groups with room.
  if (groups.length > 1 && groups[groups.length - 1].length < minSize) {
    const tail = groups.pop();
    for (const w of tail) {
      const target = groups.find((g) => g.length < maxSize + 2);
      if (target) target.push(w);
      else groups.push([w]);
    }
  }
  return groups;
}

/**
 * Evaluate a proposed grouping for competitive disparity. Returns per-group
 * worst-pair reports + alternative suggestions (regrouped by rating within
 * eligibility). Age/weight eligibility are HARD constraints; ratings never
 * override them.
 */
export function evaluateGrouping({ groups, assessments, eligible }) {
  // eligible: Set/list of wrestler ids allowed in this division.
  const allowed = new Set(eligible);
  const byId = Object.fromEntries(assessments.map((a) => [a.wrestlerId, a]));
  const reports = groups.map((g, gi) => {
    const problems = [];
    const ineligible = g.filter((id) => !allowed.has(id));
    if (ineligible.length) {
      problems.push({ level: 'confirmed-conflict', message: `Group ${gi + 1} contains ineligible wrestlers: ${ineligible.join(', ')}` });
    }
    let worst = { level: 'ok', gap: 0 };
    for (let x = 0; x < g.length; x++) {
      for (let y = x + 1; y < g.length; y++) {
        const d = disparity(byId[g[x]] || { confidence: 'none' }, byId[g[y]] || { confidence: 'none' });
        const rank = { ok: 0, 'insufficient-evidence': 1, 'possible-limited': 2, likely: 3, 'confirmed-conflict': 4 };
        if ((rank[d.level] || 0) > (rank[worst.level] || 0)) worst = { ...d, pair: [g[x], g[y]] };
      }
    }
    return { group: gi + 1, members: [...g], worst, problems };
  });
  return reports;
}

/** Alternative grouping: sort eligible by rating (unknowns last, flagged), snake into groups. */
export function alternativeGrouping({ eligibleIds, assessments, groupSize = 5 }) {
  const byId = Object.fromEntries(assessments.map((a) => [a.wrestlerId, a]));
  const known = []; const unknown = [];
  for (const id of eligibleIds) {
    const a = byId[id];
    if (!a || a.confidence === 'none') unknown.push(id);
    else known.push(id);
  }
  known.sort((x, y) => byId[y].rating - byId[x].rating);
  const n = Math.max(1, Math.round(eligibleIds.length / groupSize));
  const groups = Array.from({ length: n }, () => []);
  known.forEach((id, i) => groups[i % n].push(id));
  unknown.forEach((id, i) => groups[i % n].push(id)); // spread unknowns, flagged
  return {
    groups,
    notes: unknown.length
      ? [`${unknown.length} wrestler(s) have no meaningful history and were spread evenly — UNKNOWN, not weak.`]
      : [],
  };
}

export { WRESTLED_OUTCOMES };
