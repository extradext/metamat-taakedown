-- drizzle/0001_init.sql — Postgres-compatible DDL (also the contract the
-- local dev JSON store mirrors). All tournament-scoped tables lead with
-- tournament_id. Run against Postgres in production; local dev uses the
-- file-backed store with identical field names.
CREATE TABLE IF NOT EXISTS wrestlers (
  id UUID PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  short_seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  grade TEXT NOT NULL,
  team_history JSONB NOT NULL DEFAULT '[]',
  skill_history JSONB NOT NULL DEFAULT '[]',
  guardian_ids JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wrestler_id_aliases (
  old_id TEXT PRIMARY KEY,
  wrestler_id UUID NOT NULL REFERENCES wrestlers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  household_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  config JSONB NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tournament_registrations (
  tournament_id UUID NOT NULL REFERENCES tournaments(id),
  wrestler_id UUID NOT NULL REFERENCES wrestlers(id),
  registered_weight REAL,
  weighin_weight REAL,
  skin_check TEXT NOT NULL DEFAULT 'pending',
  skin_checked_by TEXT,
  skin_checked_at TIMESTAMPTZ,
  division TEXT,
  eligible BOOLEAN NOT NULL DEFAULT FALSE,
  concussion_lock BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tournament_id, wrestler_id)
);
CREATE TABLE IF NOT EXISTS brackets (
  tournament_id UUID NOT NULL REFERENCES tournaments(id),
  id UUID PRIMARY KEY,
  division TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  structure JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS matches (
  tournament_id UUID NOT NULL,
  id UUID PRIMARY KEY,
  bracket_id UUID NOT NULL REFERENCES brackets(id),
  round_label TEXT NOT NULL,
  bracket_side TEXT NOT NULL DEFAULT 'WB',
  mat TEXT,
  bout_number INTEGER,
  slot_a JSONB NOT NULL,
  slot_b JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  live_score JSONB,
  result JSONB,
  ended_at TIMESTAMPTZ,
  scored_by TEXT,
  CONSTRAINT matches_tournament_fk FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
);
CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches (tournament_id);
CREATE TABLE IF NOT EXISTS match_events (
  tournament_id UUID NOT NULL,
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_events_tournament_idx ON match_events (tournament_id);
CREATE TABLE IF NOT EXISTS kudos_events (
  tournament_id UUID NOT NULL,
  id UUID PRIMARY KEY,
  giver_account_id UUID NOT NULL REFERENCES accounts(id),
  wrestler_id UUID NOT NULL REFERENCES wrestlers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kudos_tournament_giver_idx ON kudos_events (tournament_id, giver_account_id);
CREATE TABLE IF NOT EXISTS notes (
  tournament_id UUID NOT NULL,
  id UUID PRIMARY KEY,
  wrestler_id UUID NOT NULL REFERENCES wrestlers(id),
  match_id UUID,
  author_account_id UUID NOT NULL REFERENCES accounts(id),
  author_role TEXT NOT NULL,
  scope TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_tournament_idx ON notes (tournament_id);
CREATE TABLE IF NOT EXISTS card_versions (
  id UUID PRIMARY KEY,
  wrestler_id UUID NOT NULL REFERENCES wrestlers(id),
  season_id TEXT NOT NULL,
  variant_index INTEGER NOT NULL,
  edition TEXT NOT NULL DEFAULT 'standard',
  template JSONB NOT NULL,
  art_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS card_on_display (
  wrestler_id UUID PRIMARY KEY REFERENCES wrestlers(id),
  card_id UUID NOT NULL REFERENCES card_versions(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS competitive_assessments (
  wrestler_id UUID PRIMARY KEY REFERENCES wrestlers(id),
  rating REAL NOT NULL,
  confidence TEXT NOT NULL,
  matches INTEGER NOT NULL DEFAULT 0,
  distinct_opponents INTEGER NOT NULL DEFAULT 0,
  last_competition TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  tournament_id UUID,
  id UUID PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_tournament_idx ON audit_log (tournament_id);
CREATE TABLE IF NOT EXISTS guardian_links (
  wrestler_id UUID NOT NULL REFERENCES wrestlers(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (wrestler_id, account_id)
);
CREATE TABLE IF NOT EXISTS household_pins (
  household_id TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  child_mode BOOLEAN NOT NULL DEFAULT FALSE,
  blur_when_wrestling BOOLEAN NOT NULL DEFAULT FALSE,
  studio_open_until TIMESTAMPTZ
);
