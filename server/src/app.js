// app.js — HTTP API + static client. Roles enforced server-side on every
// route (R8). "Identified" = signed-in account with a Bearer session token.
// Demo build logs in via account picker; production adds password/OAuth.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadDb, saveDb, audit, tournamentMatches, resolveWrestler, tournamentRegistrations } from './stores.js';
import { newTournamentId, createTournamentConfig, freezeConfig, correctConfig, getPreset } from './rules.js';
import { newId } from './ids.js';
import {
  generateDoubleElim, generateSingleElim, generateRoundRobin, resolveWrestler as resolveW,
  recordResult, readyMatches, restStatus, lastBoutEnd, eligibility, seedingFlags, doubleElimPlacements,
  singleElimPlacements, roundRobinStandings, maybeCreateReset, poolSplit, poolAdvancers,
} from './engine.js';
import {
  register, checkin, scoreMatch, tableInput, undoPlay, giveKudos, kudosTallies,
  createCardEvent, setOnDisplay, mintMilestone, clockIn, clockOut, setHouseholdPin, checkHouseholdPin,
  createInvite, acceptInvite, approveGuardian, kidConflicts, nextBoutFor,
  tournamentStats, ownsTournament, setTournamentInfo, TOURNAMENT_INFO_FIELDS,
} from './tournament.js';
import { assess, evaluateGrouping, alternativeGrouping, madisonGroups } from './matching.js';
import { encodeHistory } from './encoding.js';
import {
  providerStatus, MetaWonderProvider, MetaSparkProvider, buildExplanation,
  samCutout, voiceTranscribe,
} from './meta.js';
import { buildDemo } from './seed.js';

const CLIENT_DIR = fileURLToPath(new URL('../../client/src/', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

/** Static file resolution, extracted for testability. Reads bytes BEFORE any
 *  header is written, so a miss can never half-respond. Unknown paths fall
 *  back to index.html (mode menu is client-side). */
export function resolveStatic(urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1).split('?')[0];
  const file = join(CLIENT_DIR, rel);
  const target = existsSync(file) && rel.indexOf('..') === -1 ? file : join(CLIENT_DIR, 'index.html');
  const bytes = readFileSync(target);
  return { bytes, contentType: MIME[extname(target)] || 'text/plain' };
}

export function createApp(db = null) {
  db = db || buildDemo(loadDb());

  const sessions = db.sessions;
  const authed = (req) => {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return null;
    const accId = sessions[m[1]];
    return accId ? db.accounts[accId] || null : null;
  };
  const need = (req, ...roles) => {
    const acc = authed(req);
    if (!acc) { const e = new Error('Sign in required.'); e.status = 401; throw e; }
    if (roles.length && !roles.includes(acc.role)) {
      const e = new Error(`Role "${acc.role}" cannot do this (needs ${roles.join('/')}).`); e.status = 403; throw e;
    }
    return acc;
  };

  // Notes visibility: private notes + coach notes are NEVER public. Guardians
  // see their linked kids' private + coach notes; coaches see coach-scoped
  // (never private household) notes; organizers see all. No account: none.
  const visibleNotes = (tid, wrestlerId, viewer) => {
    const all = Object.values(db.notes).filter((n) =>
      (!tid || !n.tournament_id || n.tournament_id === tid) && n.wrestler_id === wrestlerId);
    if (!viewer) return [];
    if (viewer.role === 'organizer') return all;
    if (viewer.role === 'coach') return all.filter((n) => n.scope !== 'private');
    if (viewer.role === 'guardian') {
      const linked = Object.values(db.guardianLinks).some((l) =>
        l.account_id === viewer.id && l.wrestler_id === wrestlerId && l.status === 'approved');
      if (!linked) return [];
      return all.filter((n) => n.scope === 'private' || n.scope === 'coach');
    }
    return [];
  };

  const routes = [];
  const on = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(pattern), handler });

  const bodyOf = (req) => new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
  });

  // ---------- auth + demo ----------
  on('POST', '^/api/auth/login$', async ({ body }) => {
    const acc = db.accounts[body.accountId];
    if (!acc) throw new Error('unknown account');
    const token = randomBytes(24).toString('hex');
    sessions[token] = acc.id;
    audit(db, { actor: acc.id, action: 'auth.login', payload: { role: acc.role } });
    persist();
    return { token, account: acc };
  });
  on('GET', '^/api/demo/accounts$', async () => ({ accounts: Object.values(db.accounts) }));
  on('GET', '^/api/demo/wrestlers$', async () => ({
    wrestlers: Object.values(db.wrestlers).filter((w) => w.is_demo).map((w) => ({ id: w.id, name: w.name, short_id: w.short_id })),
  }));
  on('GET', '^/api/me/wrestlers$', async ({ req }) => {
    const acc = need(req, 'guardian', 'organizer', 'coach');
    const mine = Object.values(db.guardianLinks).filter((l) => l.account_id === acc.id && l.status === 'approved').map((l) => l.wrestler_id);
    return { wrestlers: mine.map((id) => db.wrestlers[id]).filter(Boolean) };
  });

  // ---------- My Wrestler snapshot ----------
  on('GET', '^/api/wrestler/([^/]+)/snapshot$', async ({ req, match, query }) => {
    const w = db.wrestlers[match[1]];
    if (!w) throw new Error('wrestler not found');
    const tid = query.get('tournamentId') || 'demo-tournament';
    const t = db.tournaments[tid];
    const next = nextBoutFor(db, tid, w.id);
    let current = false;
    if (next?.bout_number != null) {
      const nums = tournamentMatches(db, tid).map((m) => m.bout_number).filter((n) => n != null);
      void nums;
      const all = Object.values(db.brackets).filter((b) => b.tournament_id === tid)
        .flatMap((b) => b.structure.matches).filter((m) => m.status !== 'completed' && m.bout_number != null)
        .sort((x, y) => x.bout_number - y.bout_number);
      current = all.length > 0 && all[0].id === next.match_id;
    }
    let rest = { state: 'clear', message: 'Clear to wrestle.' };
    if (t) {
      const all = Object.values(db.brackets).filter((b) => b.tournament_id === tid).flatMap((b) => b.structure.matches);
      rest = restStatus({ lastBoutEndIso: lastBoutEnd(all, w.id), nowIso: new Date().toISOString(), restFloorMin: t.config.values.restFloorMin });
    }
    const today = Object.values(db.brackets).filter((b) => b.tournament_id === tid).flatMap((b) => b.structure.matches)
      .filter((m) => m.status === 'completed' && m.result && (m.result.winnerId === w.id || m.result.loserId === w.id));
    const disp = db.onDisplay[w.id];
    const notes = visibleNotes(tid, w.id, authed(req));
    return {
      wrestler: { id: w.id, name: w.name, grade: w.grade, short_id: w.short_id, team: w.team_history?.at(-1)?.team || 'Unattached' },
      card: disp ? db.cards[disp.card_id] || null : null,
      next: next ? { ...next, current } : null, rest,
      notes: notes.map((n) => ({ body: n.body, scope: n.scope, author_role: n.author_role, at: n.created_at })),
      coachFeedback: notes.filter((n) => n.author_role === 'coach').map((n) => n.body),
      today: today.length
        ? today.map((m) => `${m.round_label}: ${m.result.winnerId === w.id ? 'Won' : 'Lost'} (${m.result.outcome}${m.result.scoreA != null ? ` ${m.result.scoreA}-${m.result.scoreB}` : ''})`).join(' · ')
        : 'No bouts yet today.',
    };
  });

  // ---------- spectator projection (public-safe only) ----------
  on('GET', '^/api/public/([^/]+)/spectate$', async ({ match }) => {
    const tid = match[1];
    const t = db.tournaments[tid];
    if (!t) throw new Error('tournament not found');
    const regs = tournamentRegistrations(db, tid);
    const team = regs.slice(0, 12).map((r) => {
      const w = db.wrestlers[r.wrestler_id];
      const nx = nextBoutFor(db, tid, r.wrestler_id);
      const all = Object.values(db.brackets).filter((b) => b.tournament_id === tid).flatMap((b) => b.structure.matches);
      const st = restStatus({ lastBoutEndIso: lastBoutEnd(all, r.wrestler_id), nowIso: new Date().toISOString(), restFloorMin: t.config.values.restFloorMin });
      return { id: w.id, name: w.name, team: w.team_history?.at(-1)?.team || 'Unattached', mat: nx?.mat ?? null, nextBout: nx?.bout_number ?? null, current: false, held: st.state === 'held' };
    });
    const brackets = Object.values(db.brackets).filter((b) => b.tournament_id === tid).map((b) => ({
      id: b.id, division: b.division, format: b.format,
      matches: b.structure.matches.map((m) => {
        const byId = Object.fromEntries(b.structure.matches.map((x) => [x.id, x]));
        const nm = (id) => (id ? db.wrestlers[id]?.name || 'TBD' : 'TBD');
        const aid = resolveW(m.slot_a, byId, b.structure.seeds);
        const bid = resolveW(m.slot_b, byId, b.structure.seeds);
        // Advancement refs for bracket wires (presentation): which prior match
        // feeds each slot, via winner-advance or loser-drop. Read-only view.
        const feed = (ref) => (ref && (ref.t === 'w' || ref.t === 'l') && byId[ref.m])
          ? { from: ref.m, via: ref.t } : null;
        return {
          label: `${m.round_label}${m.mat ? ` · Mat ${m.mat}` : ''}${m.bout_number ? ` · Bout ${m.bout_number}` : ''}`,
          a: nm(aid), b: nm(bid),
          result: m.result ? `${db.wrestlers[m.result.winnerId]?.name} (${m.result.outcome})` : null,
          id: m.id, round: m.round_label, side: m.bracket_side, status: m.status,
          bout: m.bout_number, mat: m.mat, aid, bid, ended: m.ended_at || null,
          scoreA: m.result?.scoreA ?? null, scoreB: m.result?.scoreB ?? null,
          outcome: m.result?.outcome || null, wid: m.result?.winnerId || null,
          live: m.status !== 'completed' && m.live_score != null,
          feedA: feed(m.slot_a), feedB: feed(m.slot_b),
        };
      }),
    }));
    const tallies = kudosTallies(db, tid);
    const kudos = Object.keys(tallies.perTournament).map((wid) => {
      const disp = db.onDisplay[wid];
      return {
        id: wid, name: db.wrestlers[wid]?.name || '?', count: tallies.perTournament[wid],
        allTime: tallies.allTime[wid] || 0, card: disp ? db.cards[disp.card_id] || null : null,
      };
    });
    return { tournament: t.name, team, brackets, bulletin: t.bulletin || [], kudos };
  });

  // ---------- tournaments + brackets (organizer) ----------
  on('POST', '^/api/tournaments/from-words$', async ({ req, body }) => {
    const acc = need(req, 'organizer');
    const wonder = new MetaWonderProvider();
    const out = await wonder.proposeRuleProfile(body.text || '');
    audit(db, { actor: acc.id, action: 'wonder.proposed', payload: { name: body.name, presetId: out.profile?.presetId, ok: out.ok, provider: out.provider } });
    persist();
    if (!out.ok) throw new Error(`Setup needs review: ${out.errors.join('; ')}`);
    return { profile: out.profile, warnings: out.warnings, provider: out.provider, isMock: out.isMock };
  });
  // ---------- tournament spaces: list, info hub, setup, stats (scoped per id) ----------
  on('GET', '^/api/tournaments$', async ({ req }) => {
    const acc = authed(req);
    return {
      tournaments: Object.values(db.tournaments).map((t) => ({
        id: t.id, name: t.name, venue: t.venue || '', status: t.status,
        mine: !!(acc && ownsTournament(acc, t)),
      })),
    };
  });
  on('GET', '^/api/tournaments/([^/]+)/info$', async ({ match }) => {
    const t = db.tournaments[match[1]];
    if (!t) throw new Error('tournament not found');
    return {
      id: t.id, name: t.name, venue: t.venue || '', status: t.status,
      info: t.info || {}, bulletin: t.bulletin || [],
      rules: { presetId: t.config.presetId, presetStatus: t.config.presetStatus, restFloorMin: t.config.values.restFloorMin },
    };
  });
  on('GET', '^/api/tournaments/([^/]+)/stats$', async ({ match }) => {
    if (!db.tournaments[match[1]]) throw new Error('tournament not found');
    return tournamentStats(db, match[1]);
  });
  on('GET', '^/api/tournaments/([^/]+)/setup$', async ({ req, match }) => {
    const acc = need(req, 'organizer');
    const t = db.tournaments[match[1]];
    if (!t) throw new Error('tournament not found');
    if (!ownsTournament(acc, t)) { const e = new Error("Only this tournament's organizer can edit its setup."); e.status = 403; throw e; }
    return {
      id: t.id, name: t.name, venue: t.venue || '', status: t.status,
      info: t.info || {}, presetId: t.config.presetId, presetStatus: t.config.presetStatus,
      values: t.config.values, configVersion: t.config.version,
    };
  });
  on('POST', '^/api/tournaments/([^/]+)/info$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer');
    const t = db.tournaments[match[1]];
    if (!t) throw new Error('tournament not found');
    if (!ownsTournament(acc, t)) { const e = new Error("Only this tournament's organizer can edit its setup."); e.status = 403; throw e; }
    setTournamentInfo(db, t.id, body || {}, { actor: acc.id });
    persist();
    return { ok: true };
  });
  on('POST', '^/api/tournaments$', async ({ req, body }) => {
    const acc = need(req, 'organizer');
    const config = createTournamentConfig(db, { presetId: body.presetId || 'youth-local', overrides: body.overrides || {}, actor: acc.id });
    const id = newTournamentId();
    const info = {};
    for (const k of TOURNAMENT_INFO_FIELDS) if (body.info?.[k] !== undefined) info[k] = body.info[k];
    db.tournaments[id] = {
      id, name: body.name || 'Untitled', venue: body.venue || '', status: 'draft',
      config, config_version: 1, is_demo: false, bulletin: [], created_at: new Date().toISOString(),
      organizerIds: [acc.id], info,
    };
    audit(db, { tournamentId: id, actor: acc.id, action: 'tournament.created', payload: { name: body.name } });
    persist();
    return { tournament: db.tournaments[id] };
  });
  on('POST', '^/api/tournaments/([^/]+)/register$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer', 'guardian');
    const w = resolveWrestler(db, body.wrestlerId || body.shortId);
    if (!w) throw new Error('wrestler not found (try the short display ID)');
    // Late-entry exception: brackets already finalized => reason required, audited.
    const locked = Object.values(db.brackets).some((b) => b.tournament_id === match[1] && ['finalized', 'in-progress', 'completed'].includes(b.status));
    if (locked && !body.lateReason) {
      const e = new Error('Brackets are already finalized — late entry needs a reason (exception workflow).');
      e.code = 'LATE_ENTRY'; throw e;
    }
    const reg = register(db, match[1], w.id, { weight: body.weight ?? null, actor: acc.id });
    if (locked) audit(db, { tournamentId: match[1], actor: acc.id, action: 'exception.late-entry', payload: { wrestlerId: w.id, reason: body.lateReason } });
    persist();
    return { reg };
  });
  const LIFECYCLE = ['draft', 'review', 'published', 'finalized', 'in-progress', 'completed'];
  on('POST', '^/api/tournaments/([^/]+)/status$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer');
    const t = db.tournaments[match[1]];
    if (!t) throw new Error('tournament not found');
    const from = LIFECYCLE.indexOf(t.status);
    const to = LIFECYCLE.indexOf(body.status);
    if (to < 0) throw new Error(`unknown status (use ${LIFECYCLE.join(' → ')})`);
    if (to !== from + 1 && !(body.status === 'review' && t.status === 'draft')) {
      throw new Error(`lifecycle moves one step at a time (now: ${t.status})`);
    }
    t.status = body.status;
    if (body.status === 'finalized') freezeConfig(db, t, acc.id);
    audit(db, { tournamentId: t.id, actor: acc.id, action: 'tournament.status', payload: { status: body.status } });
    persist();
    return { ok: true };
  });
  // Pool-to-bracket, step 1: RR pools. Step 2 (finals) waits for pool results.
  on('POST', '^/api/tournaments/([^/]+)/pools$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer');
    const tid = match[1];
    const pools = poolSplit(body.seedIds || [], body.numPools || 2);
    const made = pools.map((seeds, i) => {
      const id = newId();
      const structure = generateRoundRobin({ bracketId: id, seeds });
      structure.matches.forEach((m, k) => { m.mat = `P${i + 1}`; m.bout_number = k + 1; });
      db.brackets[id] = { id, tournament_id: tid, division: `${body.division || 'Open'} Pool ${i + 1}`, format: 'round-robin', status: 'draft', structure };
      return id;
    });
    audit(db, { tournamentId: tid, actor: acc.id, action: 'pools.generated', payload: { pools: made } });
    persist();
    return { poolBracketIds: made };
  });
  on('POST', '^/api/tournaments/([^/]+)/finals$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer');
    const tid = match[1];
    const t = db.tournaments[tid];
    const pools = (body.poolBracketIds || []).map((id) => db.brackets[id]?.structure);
    if (pools.some((s) => !s)) throw new Error('pool bracket not found');
    const adv = poolAdvancers(pools, { advance: body.advance || 2, diffCap: t.config.values.rrDiffCap });
    const id = newId();
    const structure = generateSingleElim({ bracketId: id, seeds: adv.flat() });
    structure.matches.forEach((m, k) => { m.mat = 'F'; m.bout_number = k + 1; });
    db.brackets[id] = { id, tournament_id: tid, division: `${body.division || 'Open'} Finals`, format: 'single-elim', status: 'draft', structure };
    audit(db, { tournamentId: tid, actor: acc.id, action: 'finals.generated', payload: { bracketId: id, advancers: adv } });
    persist();
    return { bracketId: id, advancers: adv };
  });
  // Dry-run simulator: clones the bracket, simulates deterministically, persists NOTHING.
  on('POST', '^/api/brackets/([^/]+)/dryrun$', async ({ req, match }) => {
    need(req, 'organizer');
    const b = db.brackets[match[1]];
    if (!b) throw new Error('bracket not found');
    const clone = JSON.parse(JSON.stringify(b.structure));
    let guard = 5000;
    while (readyMatches(clone).length && guard-- > 0) {
      const byId = Object.fromEntries(clone.matches.map((m) => [m.id, m]));
      for (const m of readyMatches(clone)) {
        const a = resolveW(m.slot_a, byId, clone.seeds);
        const c = resolveW(m.slot_b, byId, clone.seeds);
        const winnerId = clone.seeds.indexOf(a) < clone.seeds.indexOf(c) ? a : c;
        recordResult(clone, m.id, {
          outcome: 'decision', winnerId, loserId: winnerId === a ? c : a, scoreA: 6, scoreB: 2,
        }, { actor: 'dryrun' });
      }
    }
    const placements = clone.format === 'round-robin'
      ? roundRobinStandings(clone, {}).placements
      : clone.format === 'single-elim' ? singleElimPlacements(clone) : doubleElimPlacements(clone);
    return {
      bouts: clone.matches.length,
      placements,
      note: 'Simulation only — lower seed always wins. Nothing was saved.',
    };
  });
  on('POST', '^/api/tournaments/([^/]+)/checkin$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer', 'table');
    const out = checkin(db, match[1], body.wrestlerId, { weighinWeight: body.weighinWeight, skinCheck: body.skinCheck, by: body.by || acc.name, actor: acc.id });
    persist();
    return out;
  });
  on('POST', '^/api/tournaments/([^/]+)/brackets$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer');
    const tid = match[1];
    const t = db.tournaments[tid];
    if (!t) throw new Error('tournament not found');
    // Gate: nobody wrestles without weigh-in + skin pass.
    const ineligible = (body.seedIds || []).filter((id) => !eligibility(db.registrations[`${tid}:${id}`]).eligible);
    if (ineligible.length) throw new Error(`weigh-in/skin gate blocks ${ineligible.length} wrestler(s) — check them in first`);
    const id = newId();
    const format = body.format === 'round-robin' ? 'round-robin' : body.format === 'single-elim' ? 'single-elim' : 'double-elim';
    const gen = format === 'round-robin' ? generateRoundRobin : format === 'single-elim' ? generateSingleElim : generateDoubleElim;
    const structure = gen({ bracketId: id, seeds: body.seedIds, consolationChallenge: t.config.values.consolationChallenge });
    const mats = body.mats || ['1A', '1B', '2A', '2B'];
    structure.matches.forEach((m, i) => { m.mat = mats[i % mats.length]; m.bout_number = i + 1; });
    const flags = seedingFlags({ seeds: body.seedIds, history: db.historical || [] });
    db.brackets[id] = { id, tournament_id: tid, division: body.division || 'Open', format, status: 'draft', structure };
    audit(db, { tournamentId: tid, actor: acc.id, action: 'bracket.generated', payload: { bracketId: id, format, seeds: body.seedIds.length, flags } });
    persist();
    return { bracket: { ...db.brackets[id], structure: { ...structure, matches: structure.matches.length } }, flags };
  });
  const setBracket = (status) => async ({ req, match }) => {
    const acc = need(req, 'organizer');
    const b = db.brackets[match[1]];
    if (!b) throw new Error('bracket not found');
    b.status = status;
    if (status === 'finalized') freezeConfig(db, db.tournaments[b.tournament_id], acc.id);
    audit(db, { tournamentId: b.tournament_id, actor: acc.id, action: `bracket.${status}`, payload: { bracketId: b.id } });
    persist();
    return { ok: true };
  };
  on('POST', '^/api/brackets/([^/]+)/publish$', setBracket('published'));
  on('POST', '^/api/brackets/([^/]+)/finalize$', setBracket('finalized'));
  on('POST', '^/api/tournaments/([^/]+)/bulletin$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer');
    db.tournaments[match[1]].bulletin.push(body.text);
    persist();
    return { ok: true };
  });
  on('POST', '^/api/config/correct$', async ({ req, body }) => {
    const acc = need(req, 'organizer');
    const t = db.tournaments[body.tournamentId];
    const cfg = correctConfig(db, t, body.overrides || {}, { actor: acc.id, reason: body.reason });
    persist();
    return { config: cfg };
  });

  // ---------- table ----------
  on('POST', '^/api/table/clockin$', async ({ req, body }) => {
    const acc = need(req, 'organizer', 'table');
    const rec = clockIn(db, body.tournamentId, body.table || '1', body.name, acc.id);
    persist();
    return rec;
  });
  on('GET', '^/api/table/([^/]+)/queue$', async ({ req, match, query }) => {
    need(req, 'organizer', 'table');
    const tid = match[1]; const table = query.get('table') || '1';
    const t = db.tournaments[tid];
    const queue = Object.values(db.brackets).filter((b) => b.tournament_id === tid)
      .flatMap((b) => b.structure.matches.map((m) => ({ b, m })))
      .filter(({ m }) => m.status !== 'completed' && m.mat?.startsWith(table))
      .sort((x, y) => (x.m.bout_number ?? 1e9) - (y.m.bout_number ?? 1e9))
      .slice(0, 10)
      .map(({ b, m }) => {
        const byId = Object.fromEntries(b.structure.matches.map((x) => [x.id, x]));
        const a = resolveW(m.slot_a, byId, b.structure.seeds);
        const c = resolveW(m.slot_b, byId, b.structure.seeds);
        const all = Object.values(db.brackets).filter((x) => x.tournament_id === tid).flatMap((x) => x.structure.matches);
        let hold = null;
        for (const id of [a, c]) {
          if (!id) continue;
          const st = restStatus({ lastBoutEndIso: lastBoutEnd(all, id), nowIso: new Date().toISOString(), restFloorMin: t.config.values.restFloorMin });
          if (st.state === 'held') hold = `${db.wrestlers[id]?.name}: ${st.message}`;
        }
        return {
          bracket_id: b.id, match_id: m.id, mat: m.mat, bout_number: m.bout_number,
          a: a ? db.wrestlers[a]?.name : 'TBD', b: c ? db.wrestlers[c]?.name : 'TBD', hold,
        };
      });
    return { queue };
  });
  on('POST', '^/api/table/score$', async ({ req, body }) => {
    const acc = need(req, 'organizer', 'table');
    const live = tableInput(db, body.tournamentId, body.bracketId, body.matchId, {
      red: undefined, green: undefined,
      ...(body.clockSec != null ? { clockSec: body.clockSec } : {}),
      ...(body.injurySec != null ? { injurySec: body.injurySec } : {}),
      ...(body.bloodSec != null ? { bloodSec: body.bloodSec } : {}),
      ...(body.period != null ? { period: body.period } : {}),
      ...(body.pauseReason ? { paused: true, pauseReason: body.pauseReason } : {}),
      ...(body.resume ? { paused: false, pauseReason: null } : {}),
      ...(body.play ? { play: body.play } : {}),
    }, { actor: acc.id });
    // Apply the play to the running score.
    if (body.play?.side === 'red' || body.play?.side === 'green') {
      void 0; // tableInput logged it; scores applied below from log
      const log = live.log;
      const red = log.filter((p) => p.side === 'red').reduce((s, p) => s + (p.points || 0), 0);
      const green = log.filter((p) => p.side === 'green').reduce((s, p) => s + (p.points || 0), 0);
      live.red = red; live.green = green;
    }
    persist();
    return live;
  });
  on('POST', '^/api/table/undo$', async ({ req, body }) => {
    const acc = need(req, 'organizer', 'table');
    const out = undoPlay(db, body.tournamentId, body.bracketId, body.matchId, { actor: acc.id });
    persist();
    return out;
  });
  on('POST', '^/api/table/finalize$', async ({ req, body }) => {
    const acc = need(req, 'organizer', 'table');
    const b = db.brackets[body.bracketId];
    const m = b.structure.matches.find((x) => x.id === body.matchId);
    const byId = Object.fromEntries(b.structure.matches.map((x) => [x.id, x]));
    const a = resolveW(m.slot_a, byId, b.structure.seeds);
    const c = resolveW(m.slot_b, byId, b.structure.seeds);
    const winnerId = body.winner === 'GREEN' ? c : a;
    const loserId = body.winner === 'GREEN' ? a : c;
    const live = m.live_score || { red: 0, green: 0 };
    const scored = scoreMatch(db, body.tournamentId, body.bracketId, body.matchId, {
      outcome: body.outcome || 'decision', winnerId, loserId,
      scoreA: live.red ?? 0, scoreB: live.green ?? 0,
    }, { actor: acc.id });
    // Grand-final reset check (R5: only when enabled).
    const t = db.tournaments[body.tournamentId];
    maybeCreateReset(b.structure, { resetEnabled: t.config.values.resetMatchEnabled });
    persist();
    return { ok: true, result: scored.result };
  });

  // ---------- kudos / notes / sharing ----------
  on('POST', '^/api/kudos$', async ({ req, body }) => {
    const acc = need(req); // any identified account
    const k = giveKudos(db, body.tournamentId, acc.id, body.wrestlerId, { actor: acc.id });
    persist();
    return k;
  });
  on('POST', '^/api/notes$', async ({ req, body }) => {
    const acc = need(req, 'guardian', 'coach', 'organizer');
    if (acc.role === 'coach' && body.scope === 'private') {
      throw new Error('A coach cannot write private household notes.');
    }
    const id = newId();
    db.notes[id] = {
      id, tournament_id: body.tournamentId || null, wrestler_id: body.wrestlerId,
      match_id: body.matchId || null, author_account_id: acc.id, author_role: acc.role,
      scope: acc.role === 'coach' ? 'coach' : (body.scope || 'private'),
      body: body.body, created_at: new Date().toISOString(),
    };
    persist();
    return db.notes[id];
  });
  on('GET', '^/api/notes$', async ({ req, query }) => {
    const acc = need(req, 'guardian', 'coach', 'organizer');
    return { notes: visibleNotes(query.get('tournamentId'), query.get('wrestlerId'), acc) };
  });
  on('POST', '^/api/sharing/invite$', async ({ req, body }) => {
    const acc = need(req, 'guardian', 'organizer');
    const inv = createInvite(db, body.wrestlerId, { by: acc.id });
    persist();
    return { token: inv.token, expires_at: inv.expires_at }; // QR encodes this token
  });
  on('POST', '^/api/sharing/accept$', async ({ req, body }) => {
    const acc = need(req, 'guardian');
    const link = acceptInvite(db, body.token, acc.id);
    persist();
    return link;
  });
  on('POST', '^/api/sharing/approve$', async ({ req, body }) => {
    const acc = need(req, 'guardian', 'organizer');
    const link = approveGuardian(db, body.wrestlerId, body.accountId, acc.id);
    persist();
    return link;
  });

  // ---------- matching (organizer/coach only — R6) ----------
  on('GET', '^/api/tournaments/([^/]+)/matching$', async ({ req, match }) => {
    need(req, 'organizer', 'coach');
    const tid = match[1];
    const regs = tournamentRegistrations(db, tid);
    const bouts = db.historical || [];
    const nowIso = new Date().toISOString();
    const rated = regs.map((r) => assess({ wrestlerId: r.wrestler_id, bouts, nowIso }));
    const groups = madisonGroups({
      wrestlers: regs.map((r) => ({
        id: r.wrestler_id, weighinWeight: r.weighinWeight ?? 70,
        team: db.wrestlers[r.wrestler_id]?.team_history?.at(-1)?.team || '?',
      })),
    }).map((g) => g.map((w) => w.id));
    const reports = evaluateGrouping({ groups, assessments: rated, eligible: regs.map((r) => r.wrestler_id) });
    const alt = alternativeGrouping({ eligibleIds: regs.map((r) => r.wrestler_id), assessments: rated });
    return { assessments: rated, groups, reports, alternative: alt };
  });
  on('POST', '^/api/tournaments/([^/]+)/matching/decision$', async ({ req, match, body }) => {
    const acc = need(req, 'organizer');
    audit(db, { tournamentId: match[1], actor: acc.id, action: body.accepted ? 'matching.accepted' : 'matching.rejected', payload: { note: body.note || '' } });
    persist();
    return { ok: true };
  });
  on('GET', '^/api/tournaments/([^/]+)/conflicts$', async ({ req, match, query }) => {
    need(req, 'organizer', 'guardian', 'coach');
    const ids = (query.get('wrestlerIds') || '').split(',').filter(Boolean);
    return kidConflicts(db, match[1], ids);
  });

  // ---------- guest bracket (same engine, same print) ----------
  on('POST', '^/api/guest/bracket$', async ({ body }) => {
    const names = (body.names || []).slice(0, 16);
    if (names.length < 2) throw new Error('need at least 2 names');
    const seeds = names.map((_, i) => `guest-${i}`);
    const struct = body.format === 'round-robin'
      ? generateRoundRobin({ bracketId: 'guest', seeds })
      : generateDoubleElim({ bracketId: 'guest', seeds });
    const byId = Object.fromEntries(struct.matches.map((m) => [m.id, m]));
    const nm = (ref) => {
      const r = resolveW(ref, byId, seeds);
      if (!r) return 'TBD';
      const i = seeds.indexOf(r);
      return i >= 0 ? names[i] : 'TBD';
    };
    const feed = (ref) => (ref && (ref.t === 'w' || ref.t === 'l') && byId[ref.m])
      ? { from: ref.m, via: ref.t } : null;
    return {
      format: struct.format,
      matches: struct.matches.map((m) => ({
        label: m.round_label, a: nm(m.slot_a), b: nm(m.slot_b),
        id: m.id, round: m.round_label, side: m.bracket_side, status: m.status,
        bout: m.bout_number, mat: m.mat,
        aid: resolveW(m.slot_a, byId, seeds) || null, bid: resolveW(m.slot_b, byId, seeds) || null,
        scoreA: null, scoreB: null, outcome: null, wid: null, live: false,
        feedA: feed(m.slot_a), feedB: feed(m.slot_b),
      })),
    };
  });

  // ---------- explain (Spark, validated), voice, meta status ----------
  on('POST', '^/api/explain$', async ({ body }) => {
    const spark = new MetaSparkProvider();
    return spark.explain({ kind: body.kind, facts: body.facts || {} });
  });
  on('POST', '^/api/voice/note$', async ({ body }) => {
    const out = await voiceTranscribe(body.audioRef || 'note');
    return out;
  });
  on('GET', '^/api/meta/status$', async () => providerStatus());
  on('GET', '^/api/encoding/([^/]+)$', async ({ req, match }) => {
    need(req, 'organizer', 'coach');
    const b = db.brackets[match[1]];
    if (!b) throw new Error('bracket not found');
    const record = {
      bracket: b.id, format: b.format,
      results: b.structure.matches.filter((m) => m.result).map((m) => ({
        id: m.id, winner: m.result.winnerId, loser: m.result.loserId, outcome: m.result.outcome,
      })),
    };
    return { code: encodeHistory(record) };
  });

  // ---------- search (role-aware) ----------
  on('GET', '^/api/search$', async ({ req, query }) => {
    const acc = authed(req);
    const q = (query.get('q') || '').toLowerCase();
    const tid = query.get('tournamentId') || 'demo-tournament';
    const results = [];
    for (const w of Object.values(db.wrestlers)) {
      if (w.name.toLowerCase().includes(q) || w.short_id.includes(q)) {
        results.push({ kind: 'wrestler', label: `${w.name} · ${w.short_id}` });
      }
    }
    for (const b of Object.values(db.brackets)) {
      if (b.tournament_id !== tid) continue;
      if (b.division.toLowerCase().includes(q)) results.push({ kind: 'bracket', label: b.division });
      for (const m of b.structure.matches) {
        if (String(m.bout_number) === q) results.push({ kind: 'bout', label: `Bout ${m.bout_number} · Mat ${m.mat}` });
      }
    }
    if (acc && ['guardian', 'coach', 'organizer'].includes(acc.role)) {
      for (const n of Object.values(db.notes)) {
        if (n.body.toLowerCase().includes(q)) results.push({ kind: 'note', label: `Note (${n.author_role}): ${n.body.slice(0, 60)}` });
      }
    }
    return { results: results.slice(0, 20) };
  });

  // ---------- studio ----------
  const householdOf = (req) => authed(req)?.household_id || 'demo-household';
  on('POST', '^/api/studio/unlock$', async ({ req, body }) => {
    if (!checkHouseholdPin(db, householdOf(req), body.pin || '')) {
      const e = new Error('Wrong PIN. This household gate is device-local — reset it with your signed-in account if you forgot it.');
      e.status = 403; throw e;
    }
    return { ok: true };
  });
  on('POST', '^/api/studio/pin$', async ({ req, body }) => {
    need(req, 'guardian', 'organizer'); // recovery/reset path through the signed-in account
    setHouseholdPin(db, householdOf(req), body.pin);
    persist();
    return { ok: true };
  });
  on('GET', '^/api/studio/album$', async ({ query }) => {
    let wid = query.get('wrestlerId');
    if (wid === 'demo') wid = Object.values(db.wrestlers).find((w) => w.is_demo)?.id;
    const cards = Object.values(db.cards).filter((c) => c.wrestler_id === wid);
    return { cards, onDisplay: db.onDisplay[wid]?.card_id || null };
  });
  on('POST', '^/api/studio/create$', async ({ req, body }) => {
    const acc = authed(req);
    let wid = body.wrestlerId;
    if (!wid) {
      const linked = Object.values(db.guardianLinks).find((l) => acc && l.account_id === acc.id && l.status === 'approved');
      wid = linked?.wrestler_id || Object.values(db.wrestlers).find((w) => w.is_demo)?.id;
    }
    const variants = await createCardEvent(db, wid, body.seasonId || 'S1', {
      answers: body.answers || {}, heroMix: body.heroMix || 'mixed', actor: acc?.id || 'demo',
    });
    persist();
    return { variants };
  });
  on('POST', '^/api/studio/display$', async ({ body }) => {
    const card = db.cards[body.cardId];
    if (!card) throw new Error('card not found');
    setOnDisplay(db, card.wrestler_id, body.cardId);
    persist();
    return { ok: true };
  });
  on('POST', '^/api/studio/photo$', async ({ body }) => {
    const out = await samCutout(body.photo || '');
    return out; // honest: framed unaltered until SAM wiring exists
  });
  on('POST', '^/api/studio/milestone$', async ({ req, body }) => {
    const acc = need(req, 'guardian', 'organizer');
    const card = await mintMilestone(db, body.wrestlerId, body.seasonId || 'S1', body.milestone, { actor: acc.id });
    persist();
    return { card };
  });
  // Child mode + blur-when-wrestling: OPTIONAL parent settings, default OFF.
  on('POST', '^/api/studio/settings$', async ({ req, body }) => {
    const acc = need(req, 'guardian', 'organizer');
    const hh = householdOf(req);
    db.pins[hh] = db.pins[hh] || { household_id: hh };
    if (body.childMode != null) db.pins[hh].child_mode = !!body.childMode;
    if (body.blurWhenWrestling != null) db.pins[hh].blur_when_wrestling = !!body.blurWhenWrestling;
    audit(db, { actor: acc.id, action: 'studio.settings', payload: { childMode: !!body.childMode, blur: !!body.blurWhenWrestling } });
    persist();
    return { ok: true, settings: { childMode: !!db.pins[hh].child_mode, blurWhenWrestling: !!db.pins[hh].blur_when_wrestling } };
  });
  on('POST', '^/api/studio/snooze$', async ({ req, body }) => {
    need(req, 'guardian', 'organizer'); // parent-chosen timer, explicitly tapped
    const mins = [5, 10, 15, 30, 60].includes(body.minutes) ? body.minutes : 15;
    const hh = householdOf(req);
    db.pins[hh] = db.pins[hh] || { household_id: hh };
    db.pins[hh].studio_open_until = new Date(Date.now() + mins * 60000).toISOString();
    persist();
    return { ok: true, openUntil: db.pins[hh].studio_open_until, label: `studio open for ${mins} minutes` };
  });
  on('GET', '^/api/studio/status$', async ({ req, query }) => {
    const hh = householdOf(req);
    const pin = db.pins[hh] || {};
    const tid = query.get('tournamentId') || 'demo-tournament';
    const ids = (query.get('wrestlerIds') || '').split(',').filter(Boolean);
    let blurActive = false; let reason = '';
    const snoozed = pin.studio_open_until && new Date(pin.studio_open_until) > new Date();
    if (pin.blur_when_wrestling && !snoozed && ids.length) {
      const all = Object.values(db.brackets).filter((b) => b.tournament_id === tid).flatMap((b) => b.structure.matches);
      const incomplete = all.filter((m) => m.status !== 'completed' && m.bout_number != null);
      const current = incomplete.length ? Math.min(...incomplete.map((m) => m.bout_number)) : null;
      for (const wid of ids) {
        const nx = nextBoutFor(db, tid, wid);
        if (nx?.bout_number != null && current != null && nx.bout_number - current <= 2) {
          blurActive = true;
          reason = `${db.wrestlers[wid]?.name || 'Your wrestler'} is on the mat, on deck, or in the hole — go watch them / get warmed up.`;
          break;
        }
      }
    }
    return {
      childMode: !!pin.child_mode, blurWhenWrestling: !!pin.blur_when_wrestling,
      blurActive, reason, snoozed: !!snoozed,
    };
  });

  // ---------- printable packet (public-safe content, linked from Organizer) ----------
  on('GET', '^/api/packet/([^/]+)$', async ({ match }) => {
    const tid = match[1];
    const t = db.tournaments[tid];
    if (!t) throw new Error('tournament not found');
    const brackets = Object.values(db.brackets).filter((b) => b.tournament_id === tid);
    const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Same normalized shape as the spectator projection: the packet renders the
    // SAME visual bracket (shared client renderer), with blank score lines for
    // bouts not yet wrestled so they can be filled in by hand on paper.
    const sheetData = brackets.map((b) => {
      const byId = Object.fromEntries(b.structure.matches.map((x) => [x.id, x]));
      const nm = (id) => (id ? db.wrestlers[id]?.name || 'TBD' : 'TBD');
      const feed = (ref) => (ref && (ref.t === 'w' || ref.t === 'l') && byId[ref.m])
        ? { from: ref.m, via: ref.t } : null;
      return {
        division: b.division, format: b.format,
        matches: b.structure.matches.map((m) => {
          const aid = resolveW(m.slot_a, byId, b.structure.seeds);
          const bid = resolveW(m.slot_b, byId, b.structure.seeds);
          return {
            id: m.id, round: m.round_label, side: m.bracket_side, status: m.status,
            bout: m.bout_number, mat: m.mat, a: nm(aid), b: nm(bid), aid, bid,
            scoreA: m.result?.scoreA ?? null, scoreB: m.result?.scoreB ?? null,
            outcome: m.result?.outcome || null, wid: m.result?.winnerId || null,
            live: false, feedA: feed(m.slot_a), feedB: feed(m.slot_b),
          };
        }),
      };
    });
    const rows = brackets.flatMap((b) => b.structure.matches.map((m) => {
      const byId = Object.fromEntries(b.structure.matches.map((x) => [x.id, x]));
      const nm = (id) => (id ? db.wrestlers[id]?.name || 'TBD' : 'TBD');
      return `<tr><td>${m.bout_number ?? ''}</td><td>${m.mat ?? ''}</td><td>${escH(b.division)}</td><td>${escH(m.round_label)}</td><td>${escH(nm(resolveW(m.slot_a, byId, b.structure.seeds)))}</td><td>${escH(nm(resolveW(m.slot_b, byId, b.structure.seeds)))}</td><td>${m.result ? escH(m.result.outcome) : ''}</td></tr>`;
    })).join('');
    const day = new Date().toLocaleDateString();
    const payload = JSON.stringify({ tournament: t.name, day, sheets: sheetData }).replace(/</g, '\\u003c');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Emergency packet — ${escH(t.name)}</title>`
      + `<link rel="stylesheet" href="/styles.css"></head><body class="packet" data-print-layout="full">`
      + `<div class="packetbar noprint"><strong>Print layout</strong><div class="chipline" id="playout">`
      + `<button class="chip" data-layout="compact">Multiple per page</button>`
      + `<button class="chip on" data-layout="full">One per page, landscape</button></div>`
      + `<button class="big" id="pprint">Print</button></div>`
      + `<h1>Emergency packet — ${escH(t.name)} (DEMO DATA)</h1>`
      + `<p>Venue: ${escH(t.venue)} · Date: ${escH(day)} · Rules: ${escH(t.config.presetId)} (${escH(t.config.presetStatus)}) · Rest floor: ${t.config.values.restFloorMin} min · Scoring: takedown ${t.config.values.scoring.takedown}</p>`
      + `<h2>Bulletin</h2><p>${escH((t.bulletin || []).join(' · '))}</p>`
      + `<div id="sheets"></div>`
      + `<h2>Mat run-order</h2><table class="runorder"><tr><th>Bout</th><th>Mat</th><th>Division</th><th>Round</th><th>Red</th><th>Green</th><th>Result</th></tr>${rows}</table>`
      + `<p>If devices lose power, run on this paper and re-enter results through the exception workflow.</p>`
      + `<script>window.PACKET=${payload}<\/script><script src="/bracket.js"><\/script>`
      + `<script>(function(){var root=document.getElementById('sheets');`
      + `window.PACKET.sheets.forEach(function(s){var d=document.createElement('div');d.className='bracket-sheet';root.appendChild(d);`
      + `window.Bracket.renderSheet(d,{title:window.PACKET.tournament+' — '+s.division,sub:window.PACKET.day,format:s.format,matches:s.matches});});`
      + `document.querySelectorAll('#playout .chip').forEach(function(c){c.onclick=function(){`
      + `document.body.dataset.printLayout=c.dataset.layout;`
      + `document.querySelectorAll('#playout .chip').forEach(function(x){x.classList.toggle('on',x===c);});};});`
      + `document.getElementById('pprint').onclick=function(){window.print();};`
      + `window.Bracket.drawWires(document);window.Bracket.fitForPrint();window.print();})()<\/script></body></html>`;
    return { __html: html };
  });

  function persist() {
    try { saveDb(db); } catch { /* dev persistence best-effort */ }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (!url.pathname.startsWith('/api/')) {
        const { bytes, contentType } = resolveStatic(url.pathname);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(bytes);
        return;
      }
      const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
      const body = await bodyOf(req);
      const out = await route.handler({ req, body, match: url.pathname.match(route.pattern), query: url.searchParams });
      if (out && out.__html) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(out.__html); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (err) {
      if (res.headersSent) { try { res.end(); } catch { /* already gone */ } return; }
      // Never leak keys/PINs in errors.
      const msg = String(err.message || 'error').replace(/sk-[A-Za-z0-9]+/g, '[redacted]');
      res.writeHead(err.status || 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg, code: err.code || null, detail: err.detail || null }));
    }
  });

  return { server, db, persist };
}
