# TEST-REPORT.md — Automated test report

Run: `npm test` (Node.js built-in runner, zero dependencies).
Last full run: 2026-11-03 — **169 tests, 53 suites, 169 pass, 0 fail** (159 prior + 10 new: 11 named card presets + mystery resolution + prompt layers; image-route model-slot guard + exact URL/model in failures; questionnaire core/pool/shuffle/preset chips; art-window card + foil finishes + regen strip; demo-regen no-re-roll cap; no-paid-aspect guard).

## Coverage by spec area

- **A9 double-elimination (generated):** sizes 2,3,4,5,6,7,8,9,12,13,16 +
  non-power-of-2; first-round-loser consol run; two-loss elimination;
  undefeated-finalist win (no reset); R5 reset only when enabled + upset
  (separate record, first final preserved); forfeit / no-show / DQ /
  injury-default / medical-forfeit / default advancement; late withdrawal
  with history preserved; single-elim shape + placements (never default);
  invalid results rejected (0–0 major, unknown outcome, wrong winner).
  Every case checks: all matches, advancement, elimination, placements,
  byes never wins, no impossible duplicates, completed results immutable,
  permanent-ID linkage, determinism.
- **A9 round-robin (generated):** sizes 2–6, N(N−1)/2 schedules,
  determinism; strict order; head-to-head 2-way; circular 3-way (mini-table
  → capped diff → allowed → seed → stable ID); configurable diff cap;
  incomplete groups (Policy A/C, no fabrication, forfeits = wins + zero
  differential); all-equal fallback (never random).
- **Pool-to-bracket:** snake split, pools-must-complete guard, top-2
  advance, finals simulated.
- **Gates:** rest hold/clear + plain-words message + END-time basis;
  finalize blocked with REST_HOLD, waiver audit-logged; bout cap
  (wrestled counts, forfeits received excluded); weigh-in/skin gate +
  concussion lock; register→checkin activation; short IDs
  (1001+, UUID shape, aliases permanent, prefix/suffix scale);
  kudos cap 3 + guest rejection + per/all-time tallies; card lock
  (3–4 kept, one display, milestone earned-only against real records);
  PIN hash-only; table 2-deep + auto-promote + third refused;
  presets DRAFT-only + third-place guard + Wonder validator;
  encoding round-trip + corruption detection; seeding flags;
  5:7 CSS lock; mode separation guards; provider honesty
  (mock default, loud real, docs-verified IDs, SAM grammar parse).
- **A10 matching:** elite>newbie ratings; sparse→limited/none confidence;
  historical vs random/seed/skill-only comparison (numbers logged, demo
  shows HOW it works — synthetic, not proof); insufficient-evidence;
  Madison properties + determinism; confirmed-conflict + alternatives.
- **Static serving:** mode menu, MIME types, fallback, traversal block.
- **Display projections:** split-surface → simple mat numbers (1A/1B→1/2…);
  ISO settings date → readable day without UTC shift; bulletin entries →
  Alerts/Parking/Snacks-Concessions/Raffles/General-Info sections with keyword
  fallback, legacy-string tolerance, expiry filter, pinned-first order.
- **Card fixes (Nov 3):** image route sends base + `/images/generations`
  once (doubled `/v1/v1` 404 fixed, pinned by stub-fetch transport test);
  text model IDs refused on the image route; failures name exact URL+model;
  11 named presets + mystery/shuffle resolution; 4-generation season
  allowance (no paid path); demo regen keeps 3–4 variants, one per season
  (no re-rolls); guided questionnaire (2 core + 4 drawn, shuffle);
  template-first art-window card, foil finishes, school-driven design.
- **Table + stats (Nov 3):** finalize confirms in-view with a displayable
  summary, advances to the next match, explains failures (no blocking
  dialogs); day totals share one decided-match predicate, outcome buckets
  provably ≤ completed (fresh seed + post-finalize).
- **End-to-end smoke** (`server/tests/e2e.local.js`, loopback-only, run
  manually — not part of `npm test`): boot, login ×4 roles, snapshot,
  clock-in, live score, finalize, rest HOLD at finalize, kudos cap + guest
  denial, Wonder setup → create, 4 card variants (labelled mock), meta
  status, guest bracket, role denial, client serves. Result: SMOKE PASSED.

## Not covered by automated tests (honest gaps)

Live Meta API calls (needs a key — flip `USE_REAL_META_AI=true` to run);
100-school load test (required before a real tournament Saturday);
browser touch-gesture feel (code-reviewed + syntax-checked, not device-run).
