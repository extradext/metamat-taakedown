// stores.js — Local-dev file-backed store mirroring drizzle/0001_init.sql.
// Every tournament-scoped read/write takes tournament_id first (§11).
// Production swaps this file for the Postgres/Drizzle adapter; field names
// and method shapes are identical.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newId, nextShortId } from './ids.js';

const DB_PATH = process.env.APP_DB || 'data/dev.json';

export function blank() {
  return {
    wrestlers: {}, aliases: {}, accounts: {}, tournaments: {},
    registrations: {}, brackets: {}, matches: {}, matchEvents: {},
    kudos: {}, notes: {}, cards: {}, onDisplay: {}, assessments: {},
    audit: {}, guardianLinks: {}, pins: {}, sessions: {}, counters: {},
    meta: { created: new Date().toISOString() },
  };
}

export function loadDb(path = DB_PATH) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  } catch { /* corrupt dev db -> start blank, never crash boot */ }
  return blank();
}

export function saveDb(db, path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(db, null, 1));
}

export function audit(db, { tournamentId = null, actor, action, payload = {} }) {
  const id = newId();
  db.audit[id] = {
    id, tournament_id: tournamentId, actor, action, payload,
    created_at: new Date().toISOString(),
  };
  return db.audit[id];
}

// ---- Wrestlers (R2: UUID authoritative, short ID persisted lookup-only) ----
export function createWrestler(db, fields, opts = {}) {
  const taken = new Set(Object.values(db.wrestlers).map((w) => w.short_id));
  const { seq, shortId } = nextShortId(taken, opts);
  const id = newId();
  const now = new Date().toISOString();
  db.wrestlers[id] = {
    id, short_id: shortId, short_seq: seq,
    name: fields.name, grade: fields.grade,
    team_history: [{ team: fields.team || 'Unattached', from: now }],
    skill_history: [{
      level: fields.skill || '1', source: fields.skillSource || 'guardian',
      date: now, by: fields.createdBy || 'system',
    }],
    guardian_ids: fields.guardianIds || [],
    is_demo: !!fields.isDemo,
    created_at: now,
  };
  return db.wrestlers[id];
}

/** Map an older ID permanently to the wrestler. Old IDs never resolve elsewhere. */
export function mapAlias(db, oldId, wrestlerId) {
  if (db.aliases[oldId] && db.aliases[oldId].wrestler_id !== wrestlerId) {
    throw new Error(`alias ${oldId} already mapped to another wrestler`);
  }
  db.aliases[oldId] = { old_id: oldId, wrestler_id: wrestlerId };
}

export function resolveWrestler(db, idOrShort) {
  if (db.wrestlers[idOrShort]) return db.wrestlers[idOrShort];
  const found = Object.values(db.wrestlers).find((w) => w.short_id === idOrShort);
  if (found) return found;
  const alias = db.aliases[idOrShort];
  if (alias) return db.wrestlers[alias.wrestler_id] || null;
  return null;
}

// ---- Tournament-scoped helpers: tournament_id FIRST, always ----
export function scoped(collection) {
  return (db, tournamentId) =>
    Object.values(collection(db)).filter((r) => r.tournament_id === tournamentId);
}
export const tournamentMatches = scoped((db) => db.matches);
export const tournamentKudos = scoped((db) => db.kudos);
export const tournamentNotes = scoped((db) => db.notes);
export const tournamentBrackets = scoped((db) => db.brackets);
export const tournamentAudit = scoped((db) => db.audit);
export function tournamentRegistrations(db, tournamentId) {
  return Object.values(db.registrations).filter((r) => r.tournament_id === tournamentId);
}
