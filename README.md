# Folkstyle Arena — Tournament Management Platform

Solo build for the **Meta Global AI Developer Hackathon 2026**
(Building window Oct 27 – Nov 4, 2026. Submission due Wed Nov 4, 2026,
9:00 p.m. ET / 8:00 p.m. CT via the Cerebral Valley platform.)

Tournament operations are the product: configure → register → check in →
deterministic brackets → table scoring with a rest gate → parents see mat +
next bout in one second. Collectible trading cards are the showcase on top
of a working tournament, never a substitute for one.

## Run it

```sh
npm start        # http://localhost:3000
npm test         # 69 tests, all passing
npm run demo:seed  # re-seed synthetic demo data (optional; boots seeded)
```

No install step: zero dependencies, Node.js 20+. The client is plain
HTML/CSS/JS with system fonts only — no external requests, gym-Wi-Fi-proof.

Demo accounts (account picker in Organizer mode): organizer, 2 table workers,
guardian (2 linked kids), coach, spectator. Demo household PIN: `2468`
(demo credential only — set yours in Card Studio; only a hash is stored).

## What was built in the hackathon window (Oct 27 – Nov 4, 2026)

- **Tier 1 Spine:** opaque-UUID identity + persisted short display IDs;
  DRAFT rules registry + config service; double-elim (true wrestlebacks),
  round-robin, pool-to-bracket, single-elim (never default) engines with
  generated A9 tests; weigh-in/skin-check gate; table scoring with rest gate,
  bout cap, UNDO, stoppage clocks; My Wrestler (mat + next-bout squares);
  live Meta call paths (below).
- **Tier 2 Showcase:** historical rating + mismatch flags + alternative
  groupings with accept/reject audit; Spotlight Card Studio (4 variants kept,
  one on display, 5:7 locked, PIN-gated, album); kudos with server-side cap;
  printable emergency packet.
- **Tier 3 Extensions:** family sharing (revocable invite + guardian approval),
  one notes system, child mode + blur-when-wrestling (optional, default off),
  photo path (SAM-honest), offline cache + stale labels, conflict monitoring,
  versioned bracket encoding, voice-note stub.

## MOCK vs. real Meta wiring

One flag: `USE_REAL_META_AI` (`false` = labelled local fallback for
development without a key; `true` = real Meta Model API calls).

| Call | Mock (flag false) | Real (flag true, docs-verified) |
|---|---|---|
| Muse Image (card art layer ONLY) | Procedural SVG, labelled `mock-art` | `POST /v1/images/generations`, model `muse-image-1.0` |
| Muse Wonder (setup → validated profile) | Keyword parser, labelled `mock-wonder`; same deterministic validator | Chat Completions JSON, model `muse-wonder-1.0` → validated before commit |
| Muse Spark (explanations, prompt structure) | Deterministic template, labelled `mock-spark` | Chat Completions, model `muse-spark-1.3`; rewrite of validated text only |
| SAM 3.1 (photo cut-out ONLY) | Honest "framed unaltered" message | `POST /v1/responses`, model `sam-3.1`; geometry for compositing, photo never regenerated |
| Voice Transcribe | Honest "not configured" message | Endpoint verified (`POST /v1/asr/transcribe`); audio upload not wired — optional, never required |

Verified against Meta's current docs at build time (checked 2026-10-30):
base `https://api.meta.ai/v1`, Bearer `MODEL_API_KEY` (or
`META_MODEL_API_KEY`), OpenAI-compatible transport; Standard-mode IDs
(content NOT used for training — the right default for children).
Sources: [models](https://dev.meta.ai/docs/models),
[media segmentation](https://dev.meta.ai/docs/media-segmentation),
[SAM overview](https://dev.meta.ai/docs/sam/overview),
[rate limits](https://dev.meta.ai/docs/pricing-rate-limits).
Rate limits are per-team, per-model; no RPM figure is hard-coded — the client
queues requests, pre-generates card variants, and honors `Retry-After` on 429.
Env overrides (`META_MODEL_IMAGE`, …) win when docs change. The key comes from
env only, never the repo or logs.
**Status of real calls in this build: mock path exercised end-to-end; real
path implemented against verified docs but NOT yet run against the live API
(needs a key). Flip with `USE_REAL_META_AI=true` + key. The
Architecture/About panel reports the live mode honestly at runtime.**

## Future / designed-for (not in the demo)

Physical card ordering, trading (offer → dual-guardian-approve → move;
designed, not built), full offline editing (packet + cached reads ship),
payments, video uploads, team-points aggregation table, open-weight
(Muse Spark Open / Glimmer) bonus path, 100-school load test.

## Scale honesty (§11)

The scaffold is NOT the 100-school production system. It is structured for
it: tournament-first scoping, deterministic engine, repository interfaces,
template-first cards. Production migration: Postgres partitioned by
tournament, stateless backend, pub/sub, per-tournament queues, CDN.
A load test simulating 100 × 300–500-wrestler tournaments is required before
a real tournament Saturday — not run here.

## Docs

- `DATA-PLAN.md` — stack, identity, record separation, card economy
- `DEMO-VIDEO.md` — 3-minute video shot list (demo order §14)
- `TEST-REPORT.md` — automated test report
- `drizzle/0001_init.sql` — Postgres-compatible DDL + journal
