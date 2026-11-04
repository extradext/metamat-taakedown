# DATA-PLAN.md — Folkstyle Arena

## Stack (declared before code, per R9)

Zero-dependency Node.js 20+ monolith (ESM, built-in `http`/`fetch`/`crypto`,
built-in `node:test`) + dependency-free static client (HTML/CSS/vanilla JS,
system fonts only, zero external requests in production).

- Local dev persistence: file-backed JSON store (`data/dev.json`, git-ignored)
  that mirrors the Postgres-compatible DDL in `drizzle/0001_init.sql`.
- Production migration (not the hackathon scaffold): Postgres partitioned by
  tournament, stateless backend behind a load balancer, pub/sub or websockets
  (no per-client DB polling), per-tournament job queue, card images in object
  storage served via CDN. Every query, view, tally, and bracket operation is
  scoped by `tournament_id` first. No global scans.
- Meta calls: built-in `fetch` to the Meta Model API behind `USE_REAL_META_AI`
  + API key (env only, never in repo/logs). Model IDs verified against
  dev.meta.ai at build time (2026-10-30) and used exactly as documented:
  `muse-image-1.0`, `muse-wonder-1.0`, `muse-spark-1.3`, `sam-3.1`,
  `muse-voice-transcribe-1.0`, base `https://api.meta.ai/v1`
  (Standard-mode IDs; nothing invented).

## Identity (R2)

- Authoritative wrestler ID: opaque random UUID (`wrestlers.id`), never derived
  from personal data, never re-derived, stable across teams/seasons/regions.
- Short display ID: persisted at creation (`short_id`, e.g. `1001`),
  unique, lookup-only, configurable prefix/suffix so it scales past 9,999.
  Never authentication. `wrestler_id_aliases` maps any older ID permanently.
- Duplicate records merge through an auditable process; history preserved.

## Record separation

`wrestlers` (permanent) → `seasons` → `profiles` → `card_versions` →
`tournament_registrations` → `bracket_assignments` → `matches` (+ `match_events`)
→ `notes`. Derived ratings live in `competitive_assessments`, never on cards.
Public profile is a permission-controlled projection (`visibility` + guardian
approvals); private tables are server-guarded, never UI-hidden only.

## Tournament lifecycle

`draft → review → published (provisional) → finalized → in-progress → completed`.
Config freezes at finalization except via the authorized correction workflow
(`audit_log` records who/when/why). Completed competition is preserved, never
dissolved; brackets stay Completed/read-only after the event.

## Outcome codes (never merged)

`bye` (no match record at all) vs `forfeit` vs `medical-forfeit` vs `default`
vs `injury-default` vs `disqualification` vs `no-show` vs wrestled results
(`pin`, `tech-fall`, `major`, `decision`). They score team points, records,
bout caps, and ratings differently — see `server/src/engine.js`.

## Rest gate

`next_bout_start >= prev_bout_end + rest_floor`, measured from match END, with
`rest_floor` read from the tournament's frozen ruleset. Waivers are logged;
the queue explains holds in plain words.

## Card economy

Up to four creation events per season → 3–4 variants kept each, ONE on display
(shared `card_on_display` record between Album and My Wrestler). Milestone
editions only when server-verified as earned. Art layer only from the model;
template renders all text/stats.

## Kudos

One identified (signed-in) giver → max 3 per tournament, server-enforced.
Free-text guest givers never count. Per-tournament AND all-time tallies from
the same events.

## Demo data

All seed data is synthetic, labelled `DEMO` in the UI and `is_demo=true` in
the store. No real children, photos, or private data in the repo.
