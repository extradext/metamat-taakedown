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
import { buildArtPrompt, MetaCardArtProvider } from './meta.js';

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
  recordResult(struct, matchId, result, { actor, at: nowIso });
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
  const existing = Object.values(db.cards).filter((c) => c.wrestler_id === wrestlerId && c.season_id === seasonId && c.edition === 'standard');
  if (existing.length > 0) {
    const err = new Error('One card creation per season — this season already has its set. Milestone editions unlock only when earned.');
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

export function setOnDisplay(db, wrestlerId, cardId, { actor = 'guardian' } = {}) {
  const card = db.cards[cardId];
  if (!card || card.wrestler_id !== wrestlerId) throw new Error('card not in this wrestler album');
  db.onDisplay[wrestlerId] = { wrestler_id: wrestlerId, card_id: cardId, updated_at: new Date().toISOString() };
  audit(db, { actor, action: 'card.displayed', payload: { wrestlerId, cardId } });
  return db.onDisplay[wrestlerId];
}

const MILESTONES = ['created-profile', 'wrestled-one', 'won-one', 'won-five'];
export function earnedMilestones(db, wrestlerId) {
  const matches = Object.values(db.matches);
  let wrestled = 0; let won = 0;
  for (const m of Object.values(db.brackets).flatMap((b) => b.structure.matches)) {
    void matches;
    if (m.status !== 'completed' || !m.result) continue;
    if (m.result.winnerId === wrestlerId || m.result.loserId === wrestlerId) {
      if (WRESTLED_OUTCOMES.includes(m.result.outcome)) {
        wrestled += 1;
        if (m.result.winnerId === wrestlerId) won += 1;
      }
    }
  }
  const earned = new Set(['created-profile']);
  if (wrestled >= 1) earned.add('wrestled-one');
  if (won >= 1) earned.add('won-one');
  if (won >= 5) earned.add('won-five');
  return earned;
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
export function createInvite(db, wrestlerId, { by, ttlMin = 60 * 24 } = {}) {
  const token = randomBytes(16).toString('hex');
  const id = newId();
  db.counters[`invite:${token}`] = {
    id, wrestler_id: wrestlerId, by,
    expires_at: new Date(Date.now() + ttlMin * 60000).toISOString(),
    revoked: false, used_by: null,
  };
  audit(db, { actor: by, action: 'sharing.invited', payload: { wrestlerId } });
  return { token, ...db.counters[`invite:${token}`] };
}

export function acceptInvite(db, token, accountId) {
  const inv = db.counters[`invite:${token}`];
  if (!inv || inv.revoked) throw new Error('invite is invalid or revoked');
  if (new Date(inv.expires_at) < new Date()) throw new Error('invite expired');
  inv.used_by = accountId;
  const key = `${inv.wrestler_id}:${accountId}`;
  db.guardianLinks[key] = { wrestler_id: inv.wrestler_id, account_id: accountId, status: 'pending' };
  audit(db, { actor: accountId, action: 'sharing.accepted', payload: { wrestlerId: inv.wrestler_id } });
  return db.guardianLinks[key];
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
        alerts.push({ level: 'red', pair: [ids[i], ids[j]], message: 'Overlapping bouts — tell the organizer; only they can move a match.' });
      } else if (apart <= 2) {
        alerts.push({ level: 'yellow', pair: [ids[i], ids[j]], message: `${apart} bout(s) apart — close / transit-risk.` });
      }
    }
  }
  return { upcoming, alerts, updated_at: new Date().toISOString() };
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
