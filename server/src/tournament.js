// tournament.js — Tournament operations over the store. Enforces: weigh-in/
// skin-check gate, rest gate, bout cap, kudos cap (server-side), card economy,
// household PIN gate semantics. Roles are enforced by the HTTP layer; every
// function here also takes an explicit actor for the audit trail.
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { newId } from './ids.js';
import { audit, tournamentKudos } from './stores.js';
import {
  eligibility, restStatus, lastBoutEnd, boutsWrestled, validateResultInput,
  recordResult, resolveWrestler, WRESTLED_OUTCOMES,
} from './engine.js';
import { buildArtPrompt, MetaCardArtProvider, describeMetaFailure } from './meta.js';

// ---------- registration + check-in (Path A/B share one gate) ----------
export function register(db, tournamentId, wrestlerId, { weight = null, actor = 'guardian' } = {}) {
  const key = `${tournamentId}:${wrestlerId}`;
  if (!db.tournaments[tournamentId]) throw new Error('tournament not found');
  if (!db.wrestlers[wrestlerId]) throw new Error('wrestler not found');
  db.registrations[key] = {
    tournament_id: tournamentId, wrestler_id: wrestlerId,
    registeredWeight: weight, weighinWeight: null,
    skinCheck: 'pending', skinCheckedBy: null, skinCheckedAt: null,
    division: null, concussionLock: false,
  };
  audit(db, { tournamentId, actor, action: 'registration.created', payload: { wrestlerId, weight } });
  return db.registrations[key];
}

export function checkin(db, tournamentId, wrestlerId, { weighinWeight, skinCheck, by, actor = 'staff' }) {
  const key = `${tournamentId}:${wrestlerId}`;
  const reg = db.registrations[key];
  if (!reg) throw new Error('not registered for this tournament');
  if (weighinWeight != null) reg.weighinWeight = weighinWeight;
  if (skinCheck) {
    if (!['pass', 'fail', 'pending'].includes(skinCheck)) throw new Error('skin check must be pass/fail/pending');
    reg.skinCheck = skinCheck; reg.skinCheckedBy = by || actor;
    reg.skinCheckedAt = new Date().toISOString();
  }
  const gate = eligibility(reg);
  audit(db, { tournamentId, actor, action: 'checkin.recorded', payload: { wrestlerId, weighinWeight: reg.weighinWeight, skinCheck: reg.skinCheck, eligible: gate.eligible } });
  return { reg, gate };
}

export function setConcussion(db, tournamentId, wrestlerId, { locked, actor }) {
  const reg = db.registrations[`${tournamentId}:${wrestlerId}`];
  if (!reg) throw new Error('not registered');
  reg.concussionLock = !!locked; // hard lock until clearance recorded (locked=false by authorized staff)
  audit(db, { tournamentId, actor, action: locked ? 'medical.lock' : 'medical.cleared', payload: { wrestlerId } });
  return reg;
}

// ---------- table workers: clock-in, handover, 2-deep authority ----------
export function clockIn(db, tournamentId, table, name, actor = 'table') {
  const key = `${tournamentId}:${table}`;
  db.counters[key] = db.counters[key] || { workers: [] };
  const crew = db.counters[key].workers.filter((w) => !w.out);
  if (crew.length >= 2) throw new Error(`Table ${table} already has 2 workers clocked in — third clock-in refused.`);
  const rec = { name, in: new Date().toISOString(), out: null, role: crew.length === 0 ? 'worker1' : 'worker2' };
  db.counters[key].workers.push(rec);
  audit(db, { tournamentId, actor, action: 'table.clockin', payload: { table, name, role: rec.role } });
  return rec;
}

export function clockOut(db, tournamentId, table, name, actor = 'table') {
  const key = `${tournamentId}:${table}`;
  const crew = (db.counters[key]?.workers || []).filter((w) => !w.out);
  const me = crew.find((w) => w.name === name);
  if (!me) throw new Error('no active clock-in for that name at this table');
  me.out = new Date().toISOString();
  // Worker 2 auto-promoted to Worker 1.
  const rest = crew.filter((w) => w !== me && !w.out);
  if (me.role === 'worker1' && rest[0]) rest[0].role = 'worker1';
  audit(db, { tournamentId, actor, action: 'table.clockout', payload: { table, name, promoted: rest[0]?.name || null } });
  return { me, promoted: rest[0] || null };
}

// Sign-in log for one tournament: every table's crew with sign-in/out times,
// current shift state, and the handoff (who Worker 1 promoted to, if any).
// Read-only projection over the clock-in records + clockout audit entries.
export function tableLog(db, tournamentId) {
  const tables = {};
  for (const [key, rec] of Object.entries(db.counters)) {
    const m = key.match(/^(.+):([^:]+)$/);
    if (!m || m[1] !== tournamentId || !rec || !Array.isArray(rec.workers)) continue;
    tables[m[2]] = rec.workers.map((w) => ({
      name: w.name, role: w.role, in: w.in, out: w.out,
      shift: w.out ? 'off shift' : 'on shift',
    }));
  }
  const handoffs = {};
  for (const e of Object.values(db.audit)) {
    if (e.tournament_id === tournamentId && e.action === 'table.clockout' && e.payload?.promoted) {
      handoffs[`${e.payload.table}:${e.payload.name}`] = e.payload.promoted;
    }
  }
  return Object.entries(tables)
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .map(([table, workers]) => ({
      table,
      workers: workers.map((w) => ({
        ...w, handoff: handoffs[`${table}:${w.name}`] || null,
      })),
    }));
}

// ---------- scoring with gates (rest gate + bout cap + eligibility) ----------
export function scoreMatch(db, tournamentId, bracketId, matchId, result, { actor = 'table', at = null, restWaiver = null } = {}) {
  const t = db.tournaments[tournamentId];
  if (!t) throw new Error('tournament not found');
  const bracket = db.brackets[bracketId];
  if (!bracket || bracket.tournament_id !== tournamentId) throw new Error('bracket not found');
  const struct = bracket.structure;
  const match = struct.matches.find((m) => m.id === matchId);
  if (!match) throw new Error('match not found');
  if (match.live_score && match.status === 'pending') {
    // A Pending bout CAN carry table input in progress; it becomes official only via result.
  }
  const check = validateResultInput({ bracket: struct, match, result, config: t.config });
  if (!check.ok) throw new Error(`invalid result: ${check.errors.join('; ')}`);
  const byId = Object.fromEntries(struct.matches.map((m) => [m.id, m]));
  const a = resolveWrestler(match.slot_a, byId, struct.seeds);
  const b = resolveWrestler(match.slot_b, byId, struct.seeds);
  // Eligibility gate for BOTH wrestlers.
  for (const id of [a, b]) {
    const gate = eligibility(db.registrations[`${tournamentId}:${id}`]);
    if (!gate.eligible) throw new Error(`weigh-in/skin gate: ${db.wrestlers[id]?.name || id} — ${gate.reason}`);
  }
  // Rest gate for BOTH wrestlers (measured from match END).
  const nowIso = at || new Date().toISOString();
  // Live bouts live in bracket structures (db.matches is the Postgres-mirror
  // collection, not the live path) — the gate MUST read structures.
  const matches = Object.values(db.brackets)
    .filter((b) => b.tournament_id === tournamentId)
    .flatMap((b) => b.structure.matches);
  for (const id of [a, b]) {
    const lastEnd = lastBoutEnd(matches, id);
    const st = restStatus({ lastBoutEndIso: lastEnd, nowIso, restFloorMin: t.config.values.restFloorMin });
    if (st.state === 'held' && !restWaiver) {
      const err = new Error(st.message);
      err.code = 'REST_HOLD';
      err.detail = { wrestlerId: id, ...st };
      throw err;
    }
    if (st.state === 'held' && restWaiver) {
      audit(db, { tournamentId, actor, action: 'rest.waived', payload: { wrestlerId: id, restedMin: st.restedMin, floor: t.config.values.restFloorMin, by: restWaiver.by, reason: restWaiver.reason } });
    }
  }
  // Bout cap.
  for (const id of [a, b]) {
    const n = boutsWrestled(matches, id);
    if (n >= t.config.values.boutCapPerDay) {
      throw new Error(`bout cap: ${db.wrestlers[id]?.name || id} already wrestled ${n} bouts today (cap ${t.config.values.boutCapPerDay})`);
    }
  }
  // Preserve stoppage clocks for stats (recordResult clears live_score).
  // Additive snapshot only — the result itself is untouched.
  const clocks = match.live_score
    ? { clockSec: match.live_score.clockSec || 0, injurySec: match.live_score.injurySec || 0, bloodSec: match.live_score.bloodSec || 0 }
    : null;
  recordResult(struct, matchId, result, { actor, at: nowIso });
  if (clocks) match.final_clocks = clocks;
  db.matchEvents[newId()] = {
    id: newId(), tournament_id: tournamentId, match_id: matchId, kind: 'result',
    payload: result, actor, created_at: nowIso,
  };
  audit(db, { tournamentId, actor, action: 'match.scored', payload: { matchId, outcome: result.outcome, winnerId: result.winnerId } });
  return match;
}

/** Table input (live score + stoppage clocks). Injury/blood time NEVER add to the match clock. */
export function tableInput(db, tournamentId, bracketId, matchId, input, { actor = 'table' } = {}) {
  const bracket = db.brackets[bracketId];
  if (!bracket || bracket.tournament_id !== tournamentId) throw new Error('bracket not found');
  const match = bracket.structure.matches.find((m) => m.id === matchId);
  if (!match) throw new Error('match not found');
  if (match.status === 'completed') throw new Error('bout is finalized; use the correction workflow');
  match.status = match.status === 'pending' ? 'in-progress' : match.status;
  match.live_score = {
    red: input.red ?? match.live_score?.red ?? 0,
    green: input.green ?? match.live_score?.green ?? 0,
    period: input.period ?? match.live_score?.period ?? 1,
    clockSec: input.clockSec ?? match.live_score?.clockSec ?? 0,
    injurySec: input.injurySec ?? match.live_score?.injurySec ?? 0,
    bloodSec: input.bloodSec ?? match.live_score?.bloodSec ?? 0,
    paused: input.paused ?? match.live_score?.paused ?? false,
    pauseReason: input.pauseReason ?? match.live_score?.pauseReason ?? null,
    log: [...(match.live_score?.log || []), ...(input.play ? [{ ...input.play, at: new Date().toISOString(), by: actor }] : [])],
  };
  return match.live_score;
}

export function undoPlay(db, tournamentId, bracketId, matchId, { actor = 'table' } = {}) {
  const bracket = db.brackets[bracketId];
  const match = bracket?.structure.matches.find((m) => m.id === matchId);
  if (!match?.live_score?.log?.length) throw new Error('nothing to undo');
  const undone = match.live_score.log.pop();
  // Reverse the named play.
  if (undone.side === 'red') match.live_score.red -= undone.points;
  if (undone.side === 'green') match.live_score.green -= undone.points;
  audit(db, { tournamentId, actor, action: 'table.undo', payload: { matchId, undone } });
  return { live: match.live_score, undone };
}

// ---------- tournament spaces: ownership, editable info, read-only stats ----------
// Tournaments never mix: every read below is scoped to one tournament id.

export function ownsTournament(acc, t) {
  if (!acc || acc.role !== 'organizer' || !t) return false;
  if (!t.organizerIds || t.organizerIds.length === 0) return true; // legacy/open
  return t.organizerIds.includes(acc.id);
}

// Editable tournament info fields (guided setup + settings editor). Rules and
// results are NOT in here — they keep their own workflows.
export const TOURNAMENT_INFO_FIELDS = [
  'type', 'defaultFormat', 'date', 'startTime', 'doorsTime', 'fee', 'regDetails',
  'tables', 'referees', 'headRef', 'weighins', 'raffle', 'contact', 'notes',
];

export function setTournamentInfo(db, tid, patch, { actor = 'organizer' } = {}) {
  const t = db.tournaments[tid];
  if (!t) throw new Error('tournament not found');
  t.info = t.info || {};
  for (const k of TOURNAMENT_INFO_FIELDS) {
    if (patch[k] !== undefined) t.info[k] = patch[k];
  }
  if (patch.name !== undefined) t.name = patch.name;
  if (patch.venue !== undefined) t.venue = patch.venue;
  audit(db, { tournamentId: tid, actor, action: 'tournament.info', payload: { keys: Object.keys(patch) } });
  return t;
}

// Read-only derived stats for the tournament hub. Blood/injury/match clocks
// come from preserved final_clocks (plus live clocks in progress).
export function tournamentStats(db, tid) {
  const brackets = Object.values(db.brackets).filter((b) => b.tournament_id === tid);
  const matches = brackets.flatMap((b) => b.structure.matches);
  const done = matches.filter((m) => m.status === 'completed' && m.result);
  const outcomes = {};
  let points = 0, clockSec = 0, bloodSec = 0, injurySec = 0, fastestPin = null;
  for (const m of done) {
    const o = m.result.outcome;
    outcomes[o] = (outcomes[o] || 0) + 1;
    points += (m.result.scoreA || 0) + (m.result.scoreB || 0);
    const fc = m.final_clocks || {};
    clockSec += fc.clockSec || 0; bloodSec += fc.bloodSec || 0; injurySec += fc.injurySec || 0;
    if (o === 'pin' && (fc.clockSec || 0) > 0 && (!fastestPin || fc.clockSec < fastestPin.sec)) {
      fastestPin = { sec: fc.clockSec, name: db.wrestlers[m.result.winnerId]?.name || '?' };
    }
  }
  for (const m of matches) {
    if (m.status !== 'completed' && m.live_score) {
      clockSec += m.live_score.clockSec || 0;
      bloodSec += m.live_score.bloodSec || 0;
      injurySec += m.live_score.injurySec || 0;
    }
  }
  const mats = [...new Set(matches.map((m) => m.mat).filter(Boolean))].sort();
  const regs = Object.values(db.registrations).filter((r) => r.tournament_id === tid);
  const teams = new Map();
  let unattached = 0;
  for (const r of regs) {
    const w = db.wrestlers[r.wrestler_id];
    const team = w?.team_history?.at(-1)?.team || 'Unattached';
    if (!w || team === 'Unattached') unattached++;
    else teams.set(team, (teams.get(team) || 0) + 1);
  }
  return {
    matchesWrestled: done.length, matchesTotal: matches.length, brackets: brackets.length,
    pins: outcomes.pin || 0, techFalls: outcomes['tech-fall'] || 0, majors: outcomes.major || 0,
    decisions: outcomes.decision || 0, injuryDefaults: outcomes['injury-default'] || 0,
    forfeits: (outcomes.forfeit || 0) + (outcomes['medical-forfeit'] || 0) + (outcomes.default || 0)
      + (outcomes.dq || 0) + (outcomes['no-show'] || 0),
    mats: mats.length, matList: mats,
    clockSec, bloodSec, injurySec,
    schools: teams.size, schoolList: [...teams.keys()].sort(),
    unattached, wrestlers: regs.length, points, fastestPin,
  };
}

// ---------- kudos: 3 per identified giver per tournament, server-side ----------
export const KUDOS_CAP = 3;
export function giveKudos(db, tournamentId, giverAccountId, wrestlerId, { actor = 'kudos' } = {}) {
  const giver = db.accounts[giverAccountId];
  if (!giver) {
    const err = new Error('Kudos are not counted until you sign in — a guest name on this device is not an identified giver.');
    err.code = 'UNIDENTIFIED';
    throw err;
  }
  const mine = tournamentKudos(db, tournamentId).filter((k) => k.giver_account_id === giverAccountId);
  if (mine.length >= KUDOS_CAP) {
    const err = new Error(`Kudos limit reached: 3 per tournament for every giver.`);
    err.code = 'KUDOS_CAP';
    throw err;
  }
  const id = newId();
  db.kudos[id] = { id, tournament_id: tournamentId, giver_account_id: giverAccountId, wrestler_id: wrestlerId, created_at: new Date().toISOString() };
  audit(db, { tournamentId, actor, action: 'kudos.given', payload: { giverAccountId, wrestlerId } });
  return db.kudos[id];
}

export function kudosTallies(db, tournamentId) {
  const per = {}; const all = {};
  for (const k of Object.values(db.kudos)) {
    all[k.wrestler_id] = (all[k.wrestler_id] || 0) + 1;
    if (k.tournament_id === tournamentId) per[k.wrestler_id] = (per[k.wrestler_id] || 0) + 1;
  }
  return { perTournament: per, allTime: all };
}

// ---------- cards: template-first, one event/season, 3-4 variants, one display ----------
export const CARD_VARIANTS = 4;
const HERO_SETS = {
  mixed: ['girl hero', 'boy hero', 'creature hero', 'girl hero'],
  girl: ['girl hero', 'girl hero', 'creature hero', 'girl hero'],
  boy: ['boy hero', 'boy hero', 'creature hero', 'boy hero'],
  creature: ['creature hero', 'creature hero', 'girl hero', 'boy hero'],
};

export async function createCardEvent(db, wrestlerId, seasonId, { answers = {}, heroMix = 'mixed', actor = 'guardian', artProvider = null } = {}) {
  const lock = seasonCreationState(db, wrestlerId, seasonId);
  if (lock.locked) {
    const err = new Error(`One card creation per season — this season already has its set. ${SEASON_LOCK_MESSAGE}. Milestone editions unlock only when earned.`);
    err.code = 'CARD_LOCK';
    throw err;
  }
  const heroes = HERO_SETS[heroMix] || HERO_SETS.mixed;
  // Default Mixed set follows the wrestler AND always includes a girl hero.
  const provider = artProvider || new MetaCardArtProvider();
  const variants = [];
  for (let i = 0; i < CARD_VARIANTS; i++) {
    const prompt = buildArtPrompt({ answers, hero: heroes[i % heroes.length] });
    const { art, provider: prov, isMock } = await provider.generateArt({ prompt });
    const id = newId();
    db.cards[id] = {
      id, wrestler_id: wrestlerId, season_id: seasonId, variant_index: i,
      edition: 'standard',
      template: {
        layout: answers.layout || 'classic', theme: answers.style || 'classic',
        border: 'foil', name: db.wrestlers[wrestlerId]?.name || 'Wrestler',
        moves: answers.moves || ['Snapdown', 'Stand-up', 'Half Nelson'],
        flavorLine: 'Card flavour — not wrestling ability. Never used for seeding, ranking, or matching.',
      },
      art, artProvider: prov, artIsMock: isMock,
      created_at: new Date().toISOString(),
    };
    variants.push(db.cards[id]);
  }
  // First variant on display; album + My Wrestler share ONE record.
  db.onDisplay[wrestlerId] = { wrestler_id: wrestlerId, card_id: variants[0].id, updated_at: new Date().toISOString() };
  audit(db, { actor, action: 'card.created', payload: { wrestlerId, seasonId, variants: variants.map((v) => v.id), heroMix } });
  return variants;
}

// ---------- demo-only regeneration: NEVER a season creation ----------
// Demo-mode extra only. It mints edition 'demo-regen' cards, which the season
// lock (it counts edition 'standard' only) never sees; it never touches the
// on-display record, so a real account's season-locked card is never
// overwritten; and it audit-logs as card.demo-regenerated, never card.created.
// It runs ONLY the live Meta path: mock/placeholder art is refused loudly and
// is never labeled generated.
export const DEMO_REGEN_EDITION = 'demo-regen';
export const DEMO_REGEN_LABEL = 'GENERATED';

export async function demoRegenerateCard(db, wrestlerId, seasonId, { answers = {}, heroMix = 'mixed', actor = 'demo', artProvider = null, env = process.env } = {}) {
  const w = db.wrestlers[wrestlerId];
  if (!w || !w.is_demo) {
    const err = new Error('Demo regeneration is demo-only — it runs only for demo wrestlers and never touches a real account\'s season-locked card.');
    err.code = 'DEMO_ONLY';
    err.status = 403;
    throw err;
  }
  const provider = artProvider || new MetaCardArtProvider(env);
  if (provider.isMock) {
    const err = new Error('Live art is off: demo regeneration needs the real Meta path (USE_REAL_META_AI=true with a Meta API key in the environment). Nothing was made — a placeholder is never labeled generated.');
    err.code = 'DEMO_LIVE_OFF';
    err.status = 400;
    throw err;
  }
  const heroes = HERO_SETS[heroMix] || HERO_SETS.mixed;
  const prompt = buildArtPrompt({ answers, hero: heroes[0] });
  let made;
  try {
    made = await provider.generateArt({ prompt });
  } catch (err) {
    const friendly = new Error(describeMetaFailure(err));
    friendly.code = 'DEMO_LIVE_FAILED';
    friendly.cause = err;
    throw friendly;
  }
  if (!made || made.isMock) {
    const err = new Error('Live art came back as a placeholder — nothing was saved, and a placeholder is never labeled generated.');
    err.code = 'DEMO_LIVE_FAILED';
    throw err;
  }
  const id = newId();
  const now = new Date().toISOString();
  db.cards[id] = {
    id, wrestler_id: wrestlerId, season_id: seasonId, variant_index: 0,
    edition: DEMO_REGEN_EDITION,
    generatedLabel: DEMO_REGEN_LABEL, generatedAt: now,
    template: {
      layout: answers.layout || 'classic', theme: answers.style || 'classic',
      border: 'foil', name: w.name || 'Wrestler',
      moves: answers.moves || ['Snapdown', 'Stand-up', 'Half Nelson'],
      flavorLine: 'Demo regeneration — a demo extra. Does not count as the season creation.',
    },
    art: made.art, artProvider: made.provider, artIsMock: false,
    created_at: now,
  };
  // On-display record deliberately untouched: the season-locked card stays put.
  audit(db, { actor, action: 'card.demo-regenerated', payload: { wrestlerId, seasonId, cardId: id, heroMix, demoOnly: true } });
  return db.cards[id];
}

export function setOnDisplay(db, wrestlerId, cardId, { actor = 'guardian' } = {}) {
  const card = db.cards[cardId];
  if (!card || card.wrestler_id !== wrestlerId) throw new Error('card not in this wrestler album');
  db.onDisplay[wrestlerId] = { wrestler_id: wrestlerId, card_id: cardId, updated_at: new Date().toISOString() };
  audit(db, { actor, action: 'card.displayed', payload: { wrestlerId, cardId } });
  return db.onDisplay[wrestlerId];
}

// A finalized result: recorded through the real scoring path (recordResult via
// scoreMatch / table finalize), which stamps status + result + ended_at +
// scored_by. Live or in-progress table input (live_score with no result) and
// hand-written completed rows without an end stamp never count.
export function isFinalizedResult(m) {
  return !!(m && m.status === 'completed' && m.result && m.ended_at);
}

// Single source for the season-lock button state: the server lock, the album
// payload, and the client CREATE area all read this shape. Standard editions
// only — demo regenerations, photos, and milestones never count as creations.
export const SEASON_LOCK_MESSAGE = 'Season creation used — next season or a paid change can create a new card';
export function seasonCreationState(db, wrestlerId, seasonId) {
  const used = Object.values(db.cards)
    .filter((c) => c.wrestler_id === wrestlerId && c.season_id === seasonId && c.edition === 'standard').length;
  const locked = used > 0;
  return {
    used: locked ? 1 : 0, remaining: locked ? 0 : 1, locked,
    message: locked ? SEASON_LOCK_MESSAGE : `Season ${seasonId}: 1 creation available.`,
  };
}

// Milestones unlock ONLY from finalized results. Legacy profile-era edition
// names still display in old albums but are never newly earned or minted.
export const MILESTONES = ['wrestled-one', 'won-one', 'won-five'];
export const LEGACY_MILESTONES = ['created-profile'];
export function earnedMilestones(db, wrestlerId) {
  let wrestled = 0; let won = 0;
  for (const b of Object.values(db.brackets)) {
    for (const m of b.structure.matches) {
      if (!isFinalizedResult(m)) continue;
      if (m.result.winnerId !== wrestlerId && m.result.loserId !== wrestlerId) continue;
      if (!WRESTLED_OUTCOMES.includes(m.result.outcome)) continue; // admin outcomes are not wrestled bouts
      wrestled += 1;
      if (m.result.winnerId === wrestlerId) won += 1;
    }
  }
  const earned = new Set();
  if (wrestled >= 1) earned.add('wrestled-one');
  if (won >= 1) earned.add('won-one');
  if (won >= 5) earned.add('won-five');
  return earned;
}

// Each milestone listed with the finalized bout(s) that earned it, plus the
// minted card id when already claimed — shown immediately after finalizing.
export function milestoneEarnings(db, wrestlerId) {
  const bouts = [];
  for (const b of Object.values(db.brackets)) {
    for (const m of b.structure.matches) {
      if (!isFinalizedResult(m)) continue;
      if (m.result.winnerId !== wrestlerId && m.result.loserId !== wrestlerId) continue;
      if (!WRESTLED_OUTCOMES.includes(m.result.outcome)) continue;
      bouts.push({
        division: b.division || b.id, bout: m.bout_number, mat: m.mat, round: m.round_label,
        outcome: m.result.outcome, won: m.result.winnerId === wrestlerId,
        scoreA: m.result.scoreA ?? null, scoreB: m.result.scoreB ?? null, ended: m.ended_at,
      });
    }
  }
  bouts.sort((x, y) => String(x.ended).localeCompare(String(y.ended)));
  const wins = bouts.filter((x) => x.won);
  const minted = {};
  for (const c of Object.values(db.cards)) {
    if (c.wrestler_id === wrestlerId && (MILESTONES.includes(c.edition) || LEGACY_MILESTONES.includes(c.edition))) {
      minted[c.edition] = c.id;
    }
  }
  return [
    { milestone: 'wrestled-one', earned: bouts.length >= 1, via: bouts.slice(0, 1), cardId: minted['wrestled-one'] || null },
    { milestone: 'won-one', earned: wins.length >= 1, via: wins.slice(0, 1), cardId: minted['won-one'] || null },
    { milestone: 'won-five', earned: wins.length >= 5, via: wins.slice(0, 5), cardId: minted['won-five'] || null },
  ];
}

// Album grouping: the on-display card, this season's variants (standard,
// demo regenerations, photos), milestone editions, and retired cards (older
// seasons or explicitly retired). Sections always render, even when empty.
export function albumSections(cards, onDisplayId) {
  const seasons = [...new Set(cards.map((c) => c.season_id))].sort();
  const currentSeason = seasons[seasons.length - 1] || 'S1';
  const onDisplay = cards.find((c) => c.id === onDisplayId) || null;
  const variants = []; const milestones = []; const retired = [];
  for (const c of cards) {
    if (c.retired || c.season_id !== currentSeason) { retired.push(c); continue; }
    if (c.edition === 'standard' || c.edition === 'demo-regen' || c.edition === 'photo') variants.push(c);
    else milestones.push(c);
  }
  return { currentSeason, onDisplay, variants, milestones, retired };
}

// Card header context: team, weight, division, and the finalized record.
// Display-only — never an input to seeding, ranking, or matching.
export function cardContext(db, wrestlerId, tournamentId = 'demo-tournament') {
  const w = db.wrestlers[wrestlerId];
  if (!w) return null;
  const regs = Object.values(db.registrations).filter((r) => r.wrestler_id === wrestlerId);
  const reg = regs.find((r) => r.tournament_id === tournamentId) || regs[0] || {};
  let division = null;
  for (const b of Object.values(db.brackets)) {
    if ((b.structure.seeds || []).includes(wrestlerId)) { division = b.division; break; }
  }
  let wins = 0; let losses = 0;
  for (const b of Object.values(db.brackets)) {
    for (const m of b.structure.matches) {
      if (!isFinalizedResult(m)) continue;
      if (!WRESTLED_OUTCOMES.includes(m.result.outcome)) continue;
      if (m.result.winnerId === wrestlerId) wins += 1;
      else if (m.result.loserId === wrestlerId) losses += 1;
    }
  }
  return {
    id: w.id, name: w.name, grade: w.grade || '',
    team: w.team_history?.at(-1)?.team || 'Unattached',
    weight: reg.weighinWeight ?? reg.registeredWeight ?? null,
    division, record: { wins, losses },
  };
}

// Uploaded-photo cards: framed, labeled PHOTO, never AI-regenerated. Photo
// editions never count as the season creation. samApplied is true only when
// the SAM cut-out call actually succeeded — never claimed otherwise.
export function savePhotoCard(db, wrestlerId, seasonId, photo, { samApplied = false, actor = 'guardian' } = {}) {
  if (!photo || typeof photo !== 'string') throw new Error('photo required');
  const w = db.wrestlers[wrestlerId];
  if (!w) throw new Error('wrestler not found');
  const variant_index = Object.values(db.cards)
    .filter((c) => c.wrestler_id === wrestlerId && c.season_id === seasonId).length;
  const id = newId();
  const now = new Date().toISOString();
  db.cards[id] = {
    id, wrestler_id: wrestlerId, season_id: seasonId, variant_index,
    edition: 'photo', photoSource: true, samApplied: !!samApplied,
    template: {
      layout: 'classic', theme: 'photo', border: 'foil', name: w.name || 'Wrestler',
      moves: ['Snapdown', 'Stand-up', 'Half Nelson'],
      flavorLine: 'Card flavour — not wrestling ability. Never used for seeding, ranking, or matching.',
    },
    art: photo, artProvider: 'upload', artIsMock: false, created_at: now,
  };
  audit(db, { actor, action: 'card.photo', payload: { wrestlerId, seasonId, cardId: id, samApplied: !!samApplied } });
  return db.cards[id];
}

export async function mintMilestone(db, wrestlerId, seasonId, milestone, { actor = 'system', artProvider = null } = {}) {
  if (!MILESTONES.includes(milestone)) throw new Error('unknown milestone');
  if (!earnedMilestones(db, wrestlerId).has(milestone)) {
    throw new Error(`Milestone "${milestone}" is not earned yet — checked against real records.`);
  }
  const dup = Object.values(db.cards).find((c) => c.wrestler_id === wrestlerId && c.season_id === seasonId && c.edition === milestone);
  if (dup) throw new Error('milestone edition already minted');
  const provider = artProvider || new MetaCardArtProvider();
  const { art, provider: prov, isMock } = await provider.generateArt({ prompt: buildArtPrompt({ answers: { style: 'shiny-glittery', finish: `${milestone} milestone foil` }, hero: 'creature hero' }) });
  const id = newId();
  db.cards[id] = {
    id, wrestler_id: wrestlerId, season_id: seasonId, variant_index: 0, edition: milestone,
    template: {
      layout: 'classic', theme: 'milestone', border: 'foil',
      name: db.wrestlers[wrestlerId]?.name || 'Wrestler',
      moves: [`Milestone: ${milestone}`],
      flavorLine: 'Milestone edition — earned, not requested. Card flavour, not ability.',
    },
    art, artProvider: prov, artIsMock: isMock, created_at: new Date().toISOString(),
  };
  audit(db, { actor, action: 'card.milestone', payload: { wrestlerId, seasonId, milestone, cardId: id } });
  return db.cards[id];
}

// ---------- household PIN: device-local household gate, hash only ----------
export function setHouseholdPin(db, householdId, pin, { actor = 'guardian' } = {}) {
  if (!pin || String(pin).length < 4) throw new Error('PIN must be at least 4 digits');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(pin), salt, 32).toString('hex');
  db.pins[householdId] = { ...(db.pins[householdId] || {}), household_id: householdId, pin_hash: `${salt}:${hash}` };
  audit(db, { actor, action: 'pin.set', payload: { householdId } }); // never the PIN/hash
  return true;
}

export function checkHouseholdPin(db, householdId, pin) {
  const rec = db.pins[householdId];
  if (!rec?.pin_hash) return false;
  const [salt, hash] = rec.pin_hash.split(':');
  const mine = scryptSync(String(pin), salt, 32).toString('hex');
  return timingSafeEqual(Buffer.from(mine), Buffer.from(hash));
}

// ---------- family sharing: time-limited revocable QR invite, guardian approval ----------
// One invite, two readings of the same grant: a long QR token plus a short
// manual code (up to 6 digits) for typing. Either one accepts or revokes;
// both die on expiry or revoke. No shared credentials ever travel here.
export function createInvite(db, wrestlerId, { by, ttlMin = 60 * 24 } = {}) {
  const token = randomBytes(16).toString('hex');
  const taken = new Set(Object.values(db.counters)
    .filter((c) => c && c.code).map((c) => c.code));
  let code = '';
  do { code = String(100000 + Math.floor(Math.random() * 900000)); } while (taken.has(code));
  const id = newId();
  db.counters[`invite:${token}`] = {
    id, wrestler_id: wrestlerId, by, code,
    expires_at: new Date(Date.now() + ttlMin * 60000).toISOString(),
    revoked: false, used_by: null,
  };
  audit(db, { actor: by, action: 'sharing.invited', payload: { wrestlerId } });
  return { token, ...db.counters[`invite:${token}`] };
}

export function findInvite(db, tokenOrCode) {
  if (db.counters[`invite:${tokenOrCode}`]) {
    return { key: `invite:${tokenOrCode}`, inv: db.counters[`invite:${tokenOrCode}`] };
  }
  const hit = Object.entries(db.counters)
    .find(([, c]) => c && c.wrestler_id && c.code === String(tokenOrCode));
  if (hit) return { key: hit[0], inv: hit[1] };
  return { key: null, inv: null };
}

export function acceptInvite(db, tokenOrCode, accountId) {
  const { inv } = findInvite(db, tokenOrCode);
  if (!inv || inv.revoked) throw new Error('invite is invalid or revoked');
  if (new Date(inv.expires_at) < new Date()) throw new Error('invite expired');
  inv.used_by = accountId;
  const key = `${inv.wrestler_id}:${accountId}`;
  db.guardianLinks[key] = { wrestler_id: inv.wrestler_id, account_id: accountId, status: 'pending' };
  audit(db, { actor: accountId, action: 'sharing.accepted', payload: { wrestlerId: inv.wrestler_id } });
  return db.guardianLinks[key];
}

export function revokeInvite(db, tokenOrCode, by) {
  const { inv } = findInvite(db, tokenOrCode);
  if (!inv) throw new Error('invite not found');
  if (inv.revoked) throw new Error('invite is already revoked');
  inv.revoked = true;
  audit(db, { actor: by, action: 'sharing.revoked', payload: { wrestlerId: inv.wrestler_id } });
  return { ok: true };
}

export function approveGuardian(db, wrestlerId, accountId, approver) {
  const key = `${wrestlerId}:${accountId}`;
  const link = db.guardianLinks[key];
  if (!link) throw new Error('no pending link');
  link.status = 'approved';
  const w = db.wrestlers[wrestlerId];
  if (w && !w.guardian_ids.includes(accountId)) w.guardian_ids.push(accountId);
  audit(db, { actor: approver, action: 'sharing.approved', payload: { wrestlerId, accountId } });
  return link;
}

// ---------- multi-kid conflict monitoring (deterministic; proximity, never clock) ----------
export function kidConflicts(db, tournamentId, wrestlerIds) {
  // Recompute on assignment/mat change/result only (caller triggers).
  const upcoming = {};
  for (const wid of wrestlerIds) {
    const next = nextBoutFor(db, tournamentId, wid);
    if (next) upcoming[wid] = next;
  }
  const ids = Object.keys(upcoming);
  const alerts = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const x = upcoming[ids[i]]; const y = upcoming[ids[j]];
      if (x.bout_number == null || y.bout_number == null) continue;
      const apart = Math.abs(x.bout_number - y.bout_number);
      if (x.mat === y.mat && apart === 0) {
        alerts.push({ level: 'red', pair: [ids[i], ids[j]], message: 'Overlapping matches — tell the organizer; only they can move a match.' });
      } else if (apart <= 2) {
        alerts.push({ level: 'yellow', pair: [ids[i], ids[j]], message: `${apart} bout(s) apart — close / transit-risk.` });
      }
    }
  }
  return { upcoming, alerts, updated_at: new Date().toISOString() };
}

// Next-match truth: a wrestler's next bout is "current" (NOW) exactly when
// THAT bout is live/in-progress — never by comparing against other mats'
// bouts. Completed bouts are never next (nextBoutFor skips them) and never
// current. One source for the snapshot flag and its tests.
export function isLiveBout(db, bracketId, matchId) {
  const b = db.brackets[bracketId];
  const m = b?.structure.matches.find((x) => x.id === matchId);
  return !!(m && m.status !== 'completed' && (m.status === 'in-progress' || m.live_score != null));
}

export function nextBoutFor(db, tournamentId, wrestlerId) {
  const out = [];
  for (const b of Object.values(db.brackets)) {
    if (b.tournament_id !== tournamentId || b.status === 'completed') continue;
    const byId = Object.fromEntries(b.structure.matches.map((m) => [m.id, m]));
    for (const m of b.structure.matches) {
      if (m.status === 'completed') continue;
      const a = resolveWrestler(m.slot_a, byId, b.structure.seeds);
      const c = resolveWrestler(m.slot_b, byId, b.structure.seeds);
      if (a === wrestlerId || c === wrestlerId) {
        out.push({ bracket_id: b.id, match_id: m.id, mat: m.mat, bout_number: m.bout_number, round: m.round_label, status: m.status });
      }
    }
  }
  out.sort((x, y) => (x.bout_number ?? 1e9) - (y.bout_number ?? 1e9));
  return out[0] || null;
}
