// seed.js — Synthetic DEMO data only. No real children, photos, or private
// data. Run: `node server/src/seed.js --write` or `npm run demo:seed`.
//
// Demo v2: one populated tournament (4 schools x 8 + 2 unattached = 34
// wrestlers, 3 double-elim divisions + 1 round robin) with a live scenario:
// completed bouts, bouts in progress, upcoming bouts, and rest-gate holds.
// Scenario bout times are relative (demo_offset_min) and refreshed every
// boot so the holds read live; outcomes, scores, and winners never change.
import { loadDb, saveDb, createWrestler } from './stores.js';
import { createTournamentConfig } from './rules.js';
import { newId } from './ids.js';
import { generateDoubleElim, generateRoundRobin, resolveWrestler as resolveW } from './engine.js';
import { register, checkin, setHouseholdPin, tableInput, scoreMatch, giveKudos } from './tournament.js';
import { buildArtPrompt, mockArt } from './meta.js';

const DEMO_VERSION = 2;
const TID = 'demo-tournament';

const SCHOOLS = [
  { name: 'River Club', color: 'blue' },
  { name: 'North Mat Club', color: 'red' },
  { name: 'Southside', color: 'green' },
  { name: 'Cedar Wrestling', color: 'gold' },
];
const FIRST = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper',
  'Ivy', 'Jordan', 'Kai', 'Logan', 'Mason', 'Nora', 'Owen', 'Parker'];
const LAST = ['Quinn', 'Sutton', 'Mora', 'Hale', 'Frost', 'Brooks', 'Patton', 'Lane',
  'Reese', 'Carter', 'Ellis', 'Ford', 'Grant', 'Hayes', 'Irwin', 'James'];
const GRADES = ['4', '5', '6'];
const SKILLS = ['1', '2', '2+', '3'];
const STYLES = ['classic', 'shiny', 'fire', 'ice', 'lightning'];
const MOVE_SETS = [
  ['Snapdown', 'Stand-up', 'Half Nelson'],
  ['Double Leg', 'Spiral Ride', 'Cradle'],
  ['Single Leg', 'Sit-out', 'Bar Arm'],
];
const HEROES = ['Tiger cub', 'Robot', 'Dragon'];

const DEMO_INFO = {
  type: 'Open', defaultFormat: 'double-elim', date: '2026-11-07', startTime: '9:00 AM',
  doorsTime: '7:30 AM', fee: '$35', regDetails: 'Register online by Nov 5. Walk-ins $45 if space allows.',
  tables: '6', referees: '6', headRef: 'Ref Rosie', weighins: 'Fri 6–8 PM, Sat 7–8 AM',
  raffle: '50/50 raffle — drawing at finals! Tickets $5.', contact: 'Olive (Organizer)',
  notes: 'Concessions all day. Bleacher seating; chairs allowed on the upper track.',
};

const _usedNames = new Set();
function demoName(i) {
  const f = FIRST[i % 16];
  let li = (i * 5 + 1) % 16;
  while (_usedNames.has(f + '|' + LAST[li])) li = (li + 1) % 16;
  _usedNames.add(f + '|' + LAST[li]);
  return f + ' ' + LAST[li];
}

// Scenario clocks stay relative so rest holds read live on every boot.
// Only flagged demo bouts shift; user-recorded results are never touched.
function refreshDemoClock(db) {
  const now = Date.now();
  for (const b of Object.values(db.brackets)) {
    if (b.tournament_id !== TID) continue;
    for (const m of b.structure.matches) {
      if (m.demo_offset_min != null && m.status === 'completed') {
        m.ended_at = new Date(now - m.demo_offset_min * 60000).toISOString();
      }
    }
  }
}

function purgeDemo(db) {
  const demoW = new Set(Object.values(db.wrestlers).filter((w) => w.is_demo).map((w) => w.id));
  delete db.tournaments[TID];
  for (const [id, b] of Object.entries(db.brackets)) if (b.tournament_id === TID) delete db.brackets[id];
  for (const [k, r] of Object.entries(db.registrations)) if (r.tournament_id === TID) delete db.registrations[k];
  for (const [id, n] of Object.entries(db.notes)) if (n.tournament_id === TID || demoW.has(n.wrestler_id)) delete db.notes[id];
  for (const [id, c] of Object.entries(db.cards)) if (demoW.has(c.wrestler_id)) delete db.cards[id];
  for (const wid of demoW) { delete db.onDisplay[wid]; delete db.wrestlers[wid]; }
  for (const [k, l] of Object.entries(db.guardianLinks)) if (demoW.has(l.wrestler_id)) delete db.guardianLinks[k];
  for (const [id, k] of Object.entries(db.kudos)) if (k.tournament_id === TID || demoW.has(k.wrestler_id)) delete db.kudos[id];
  for (const [id, e] of Object.entries(db.matchEvents)) if (e.tournament_id === TID) delete db.matchEvents[id];
  db.historical = [];
}

function assignMats(struct, mats) {
  struct.matches.forEach((m, i) => {
    m.mat = mats[i % mats.length];
    m.bout_number = i + 1;
  });
}

// Complete one demo bout through the real scoring path (gates enforced).
function seedResult(db, bracketId, match, pick, outcome, wPts, lPts, offsetMin, clocks) {
  const b = db.brackets[bracketId];
  const byId = Object.fromEntries(b.structure.matches.map((x) => [x.id, x]));
  const a = resolveW(match.slot_a, byId, b.structure.seeds);
  const c = resolveW(match.slot_b, byId, b.structure.seeds);
  if (!a || !c) throw new Error('seed scenario: slots unresolved for ' + match.round_label);
  if (clocks) tableInput(db, TID, bracketId, match.id, clocks, { actor: 'seed' });
  const at = new Date(Date.now() - offsetMin * 60000).toISOString();
  scoreMatch(db, TID, bracketId, match.id, {
    outcome, winnerId: pick === 'a' ? a : c, loserId: pick === 'a' ? c : a,
    scoreA: pick === 'a' ? wPts : lPts, scoreB: pick === 'a' ? lPts : wPts,
  }, { actor: 'seed', at });
  match.demo_offset_min = offsetMin;
}

function seedDE(db, bracketId, division, seedIds, mats, d) {
  const struct = generateDoubleElim({ bracketId, seeds: seedIds });
  assignMats(struct, mats);
  db.brackets[bracketId] = { id: bracketId, tournament_id: TID, division, format: 'double-elim', status: 'published', structure: struct };
  const wb1 = struct.matches.filter((m) => m.round_label === 'WB-1');
  const r2 = struct.matches.filter((m) => m.round_label === 'WB-2');
  const c1 = struct.matches.filter((m) => m.round_label === 'CONS-1');
  const pick = (k) => ((k + d) % 2 === 0 ? 'a' : 'b');
  const outs = [
    ['decision', 6, 2, 200, { clockSec: 320 }],
    ['major', 12, 4, 180, { clockSec: 340, bloodSec: 20 }],
    ['pin', 6, 0, 160, { clockSec: 200 + d * 15, bloodSec: 30 }],
  ];
  seedResult(db, bracketId, wb1[0], pick(0), ...outs[d % 3]);
  seedResult(db, bracketId, wb1[1], pick(1), ...outs[(d + 1) % 3]);
  // Third R1 bout is live right now.
  tableInput(db, TID, bracketId, wb1[2].id, { red: 4, green: 2, period: 2, clockSec: 65 }, { actor: 'seed' });
  seedResult(db, bracketId, wb1[3], pick(3), ...outs[(d + 2) % 3]);
  // Winners semi with two clear wrestlers, just finished — winner is HELD.
  seedResult(db, bracketId, r2[0], pick(4), 'decision', 5, 3, 8, { clockSec: 360 });
  // Consol opener between two long-clear losers.
  seedResult(db, bracketId, c1[0], pick(5), 'tech-fall', 18, 3, 45, { clockSec: 280 });
}

function seedRR(db, bracketId, division, seedIds, mats) {
  const struct = generateRoundRobin({ bracketId, seeds: seedIds });
  assignMats(struct, mats);
  db.brackets[bracketId] = { id: bracketId, tournament_id: TID, division, format: 'round-robin', status: 'published', structure: struct };
  const r1 = struct.matches.filter((m) => m.round_label === 'RR ROUND 1');
  const r2 = struct.matches.filter((m) => m.round_label === 'RR ROUND 2');
  const outs = [
    ['decision', 7, 2], ['major', 11, 3], ['pin', 6, 0], ['decision', 5, 1],
    ['decision', 8, 5], ['major', 13, 4],
  ];
  [...r1, r2[0], r2[1]].forEach((m, k) => {
    const [outcome, wPts, lPts] = outs[k];
    seedResult(db, bracketId, m, k % 2 === 0 ? 'a' : 'b', outcome, wPts, lPts,
      [120, 110, 100, 90, 60, 50][k], { clockSec: 200 + k * 20 + (outcome === 'pin' ? -105 : 0), bloodSec: k === 2 ? 40 : 0 });
  });
}

function seedCards(db, wrestlers) {
  const now = new Date().toISOString();
  wrestlers.forEach((w, i) => {
    const team = w.team_history?.at(-1)?.team || 'Unattached';
    const color = (SCHOOLS.find((s) => s.name === team) || { color: 'gray' }).color;
    for (let k = 0; k < 3; k++) {
      const style = STYLES[(i + k) % STYLES.length];
      const prompt = buildArtPrompt({ answers: { style, color, animal: 'tiger' }, hero: HEROES[k % HEROES.length] });
      const { art, provider, isMock } = mockArt(prompt);
      const id = newId();
      db.cards[id] = {
        id, wrestler_id: w.id, season_id: 'S1', variant_index: k, edition: 'standard',
        template: {
          layout: 'classic', theme: style, border: 'foil', name: w.name,
          moves: MOVE_SETS[(i + k) % MOVE_SETS.length],
          flavorLine: 'Card flavour — not wrestling ability. Never used for seeding, ranking, or matching.',
        },
        art, artProvider: provider, artIsMock: isMock, created_at: now,
      };
      if (k === 0) db.onDisplay[w.id] = { wrestler_id: w.id, card_id: id, updated_at: now };
    }
  });
}

function seedNotes(db, wrestlers) {
  const now = new Date().toISOString();
  const note = (wid, role, accId, scope, body, agoMin) => {
    const id = newId();
    db.notes[id] = {
      id, tournament_id: TID, wrestler_id: wid, match_id: null,
      author_account_id: accId, author_role: role, scope, body,
      created_at: new Date(Date.now() - agoMin * 60000).toISOString(),
    };
  };
  const [k1, k2] = [wrestlers[0], wrestlers[4]];
  note(k1.id, 'guardian', 'acc-guardian', 'private', 'Packed extra headgear strap and two singlets. Water bottle in the blue bag.', 300);
  note(k1.id, 'guardian', 'acc-guardian', 'private', 'Warm up on the far mats — quieter over there before bout 3.', 40);
  note(k1.id, 'coach', 'acc-coach', 'coach', 'Great sprawl timing today. Keep the elbows in on the stand-up.', 25);
  note(k2.id, 'guardian', 'acc-guardian', 'private', 'Reminder: inhaler with coach before warm-ups.', 200);
  note(k2.id, 'coach', 'acc-coach', 'coach', 'Attack the legs early — first takedown wins these matches.', 15);
  note(wrestlers[1].id, 'coach', 'acc-coach', 'coach', 'Bottom work looked sharp. Chain the sit-out to the Peterson.', 50);
  void now;
}

export function buildDemo(db) {
  refreshDemoClock(db);
  const t = db.tournaments[TID];
  if (t && t.demoVersion === DEMO_VERSION) return db; // idempotent
  if (t) purgeDemo(db); // stale demo: rebuild the scenario, keep user data
  // Accounts with roles (R8). Never overwrite existing accounts.
  const mk = (id, role, name, household) => {
    if (!db.accounts[id]) db.accounts[id] = { id, role, name, household_id: household || null };
  };
  mk('acc-organizer', 'organizer', 'Olive (Organizer)', 'demo-household');
  mk('acc-table1', 'table', 'Table Worker 1', null);
  mk('acc-table2', 'table', 'Table Worker 2', null);
  mk('acc-guardian', 'guardian', 'Gus (Guardian)', 'demo-household');
  mk('acc-coach', 'coach', 'Coach Cam', null);
  mk('acc-spectator', 'spectator', 'Spectator Sam', null);

  // 34 wrestlers: 4 schools x 8 + 2 unattached.
  const specs = [];
  for (let i = 0; i < 32; i++) specs.push({ name: demoName(i), grade: GRADES[i % 3], team: SCHOOLS[i % 4].name });
  specs.push({ name: demoName(32), grade: '5', team: null }, { name: demoName(33), grade: '6', team: null });
  const wrestlers = specs.map((s, i) => createWrestler(db, {
    name: s.name, grade: s.grade, team: s.team, skill: SKILLS[i % 4],
    skillSource: 'guardian', guardianIds: (i === 0 || i === 4) ? ['acc-guardian'] : [], isDemo: true,
  }));
  // Guardian links two kids on the same club (multi-kid conflict demo).
  for (const w of [wrestlers[0], wrestlers[4]]) {
    db.guardianLinks[`${w.id}:acc-guardian`] = { wrestler_id: w.id, account_id: 'acc-guardian', status: 'approved' };
  }

  const config = createTournamentConfig(db, { presetId: 'youth-local', overrides: {}, actor: 'seed' });
  db.tournaments[TID] = {
    id: TID, name: 'Demo Youth Open', venue: 'Demo Fieldhouse, Mat Hall',
    status: 'published', config, config_version: 1, is_demo: true, demoVersion: DEMO_VERSION,
    bulletin: ['Welcome to the Demo Youth Open!', 'Weigh-ins close at 8:30 AM.', '50/50 raffle drawing at finals!'],
    organizerIds: ['acc-organizer'], info: { ...DEMO_INFO },
    created_at: new Date().toISOString(),
  };
  // Register + check in everyone (Path A completed). Weights by division band.
  wrestlers.forEach((w, i) => {
    const band = i < 8 ? 65 : i < 16 ? 76 : i < 24 ? 87 : 70;
    const wt = band + (i % 8);
    register(db, TID, w.id, { weight: wt, actor: 'seed' });
    checkin(db, TID, w.id, { weighinWeight: wt, skinCheck: 'pass', by: 'seed-staff', actor: 'seed' });
  });
  const ids = wrestlers.map((w) => w.id);
  seedDE(db, 'demo-de-bantam', 'Bantam 65-75', ids.slice(0, 8), ['1A', '1B'], 0);
  seedDE(db, 'demo-de-midget', 'Midget 76-86', ids.slice(8, 16), ['2A', '2B'], 1);
  seedDE(db, 'demo-de-junior', 'Junior 87-97', ids.slice(16, 24), ['3A', '3B'], 2);
  seedRR(db, 'demo-rr', 'Novice Round-Robin', ids.slice(24, 32), ['1A', '1B']);
  seedCards(db, wrestlers);
  seedNotes(db, wrestlers);
  // Kudos from three identified givers (cap respected).
  giveKudos(db, TID, 'acc-guardian', wrestlers[2].id, { actor: 'seed' });
  giveKudos(db, TID, 'acc-coach', wrestlers[6].id, { actor: 'seed' });
  giveKudos(db, TID, 'acc-organizer', wrestlers[10].id, { actor: 'seed' });
  // Historical bouts for matching demo (synthetic, prior season).
  db.historical = [
    { winnerId: wrestlers[0].id, loserId: wrestlers[2].id, outcome: 'decision', at: '2026-01-10T00:00:00Z', hasScore: true },
    { winnerId: wrestlers[0].id, loserId: wrestlers[3].id, outcome: 'major', at: '2026-01-17T00:00:00Z', hasScore: true },
    { winnerId: wrestlers[2].id, loserId: wrestlers[4].id, outcome: 'pin', at: '2026-01-17T00:00:00Z', hasScore: true },
  ];
  // Demo household PIN (demo credential only; never displayed in UI).
  setHouseholdPin(db, 'demo-household', '2468', { actor: 'seed' });
  return db;
}

const runDirect = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (process.argv.includes('--write')) {
  const db = loadDb();
  buildDemo(db);
  saveDb(db);
  console.log('demo seed written (synthetic data only)');
}
void runDirect;
