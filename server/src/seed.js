// seed.js — Synthetic DEMO data only. No real children, photos, or private
// data. Run: `node server/src/seed.js --write` or `npm run demo:seed`.
import { loadDb, saveDb, createWrestler } from './stores.js';
import { createTournamentConfig } from './rules.js';
import { newId } from './ids.js';
import { generateDoubleElim, generateRoundRobin } from './engine.js';
import { register, checkin, setHouseholdPin } from './tournament.js';

const NAMES = [
  ['Avery Quinn', '5', 'River Club'], ['Blake Sutton', '5', 'River Club'],
  ['Casey Mora', '6', 'North Mat Club'], ['Devon Hale', '6', 'North Mat Club'],
  ['Emery Frost', '4', 'River Club'], ['Finley Brooks', '5', 'South Club'],
  ['Gray Patton', '6', 'South Club'], ['Harper Lane', '4', 'North Mat Club'],
];

export function buildDemo(db) {
  if (db.tournaments['demo-tournament']) return db; // idempotent
  // Accounts with roles (R8).
  const mk = (id, role, name, household) => { db.accounts[id] = { id, role, name, household_id: household || null }; };
  mk('acc-organizer', 'organizer', 'Olive (Organizer)', 'demo-household');
  mk('acc-table1', 'table', 'Table Worker 1', null);
  mk('acc-table2', 'table', 'Table Worker 2', null);
  mk('acc-guardian', 'guardian', 'Gus (Guardian)', 'demo-household');
  mk('acc-coach', 'coach', 'Coach Cam', null);
  mk('acc-spectator', 'spectator', 'Spectator Sam', null);

  const wrestlers = NAMES.map(([name, grade, team], i) =>
    createWrestler(db, {
      name, grade, team, skill: ['1', '2', '2+', '3'][i % 4],
      skillSource: 'guardian', guardianIds: i < 2 ? ['acc-guardian'] : [], isDemo: true,
    }));
  // Guardian links two kids (multi-kid conflict demo).
  db.guardianLinks[`${wrestlers[0].id}:acc-guardian`] = { wrestler_id: wrestlers[0].id, account_id: 'acc-guardian', status: 'approved' };
  db.guardianLinks[`${wrestlers[1].id}:acc-guardian`] = { wrestler_id: wrestlers[1].id, account_id: 'acc-guardian', status: 'approved' };

  const config = createTournamentConfig(db, { presetId: 'youth-local', overrides: {}, actor: 'seed' });
  db.tournaments['demo-tournament'] = {
    id: 'demo-tournament', name: 'Demo Youth Open', venue: 'Demo Fieldhouse, Mat Hall',
    status: 'published', config, config_version: 1, is_demo: true,
    bulletin: ['Welcome to the Demo Youth Open!', 'Weigh-ins close at 8:30 AM.'],
    created_at: new Date().toISOString(),
  };
  // Register + check in all eight (Path A completed).
  wrestlers.forEach((w, i) => {
    register(db, 'demo-tournament', w.id, { weight: 65 + i * 3, actor: 'seed' });
    checkin(db, 'demo-tournament', w.id, { weighinWeight: 65 + i * 3, skinCheck: 'pass', by: 'seed-staff', actor: 'seed' });
  });
  // One 8-man double-elim bracket + one 4-man round robin, mats assigned.
  const mkw = (ids) => ids;
  const de = generateDoubleElim({ bracketId: 'demo-de', seeds: mkw(wrestlers.map((w) => w.id)) });
  assignMats(de, ['1A', '1B', '2A', '2B']);
  db.brackets['demo-de'] = {
    id: 'demo-de', tournament_id: 'demo-tournament', division: 'Bantam 65-75',
    format: 'double-elim', status: 'published', structure: de,
  };
  const rr = generateRoundRobin({ bracketId: 'demo-rr', seeds: mkw(wrestlers.slice(0, 4).map((w) => w.id)) });
  assignMats(rr, ['1A', '1B']);
  db.brackets['demo-rr'] = {
    id: 'demo-rr', tournament_id: 'demo-tournament', division: 'Midget Round-Robin',
    format: 'round-robin', status: 'published', structure: rr,
  };
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

function assignMats(struct, mats) {
  struct.matches.forEach((m, i) => {
    m.mat = mats[i % mats.length];
    m.bout_number = i + 1;
  });
}

const runDirect = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (process.argv.includes('--write')) {
  const db = loadDb();
  buildDemo(db);
  saveDb(db);
  console.log('demo seed written (synthetic data only)');
}
void runDirect;
