// rules.js — Versioned rules registry + tournament config service.
// R7: EVERY preset ships as DRAFT (validationStatus:'draft') with source and
// edition fields present. Only the project owner marks a preset validated
// after checking the source. Unverified presets are NEVER presented as
// official. Values below are editable DRAFT defaults, not official rules.
import { newId } from './ids.js';
import { audit } from './stores.js';

export const RULE_SOURCES = {
  NFHS: 'National Federation of State High School Associations',
  NCAA: 'National Collegiate Athletic Association',
  USAW: 'USA Wrestling',
  AAU: 'Amateur Athletic Union',
  LOCAL: 'Local / league house rules',
};

function draftPreset(id, source, edition, values) {
  return {
    id, source, edition, validationStatus: 'draft',
    validatedBy: null, validatedAt: null, sourceDoc: '',
    lastReviewed: null, values,
  };
}

const BASE_SCORING = {
  takedown: 3, escape: 1, reversal: 2, nearFall2: 2, nearFall3: 3,
  nearFall4: 4, techFallPoints: 15,
};

export const RULE_PRESETS = [
  draftPreset('nfhs-2024-25', 'NFHS', '2024-25', {
    scoring: { ...BASE_SCORING }, techFallContinuation: true, periods: 3, periodLengthSec: 120,
    restFloorMin: 30, boutCapPerDay: 5, placementDepth: 6,
    headgear: 'required', challengeBrick: false,
    consolationChallenge: true, resetMatchEnabled: false,
    thirdPlaceMatch: false, wrestlebackDepth: 'full',
    rrWithdrawalPolicy: 'A', rrDiffCap: 15, overtime: 'nfhs-draft',
  }),
  draftPreset('ncaa-2024-25', 'NCAA', '2024-25', {
    scoring: { ...BASE_SCORING }, techFallContinuation: true, periods: 3, periodLengthSec: 180,
    restFloorMin: 30, boutCapPerDay: 6, placementDepth: 8,
    headgear: 'required', challengeBrick: false,
    consolationChallenge: false, resetMatchEnabled: false,
    thirdPlaceMatch: true, wrestlebackDepth: 'full',
    rrWithdrawalPolicy: 'A', rrDiffCap: 15, overtime: 'ncaa-draft',
  }),
  draftPreset('usaw-2025-26', 'USAW', '2025-26', {
    scoring: { ...BASE_SCORING }, techFallContinuation: true, periods: 2, periodLengthSec: 120,
    restFloorMin: 15, boutCapPerDay: 5, placementDepth: 6,
    headgear: 'recommended-not-required', challengeBrick: true,
    consolationChallenge: true, resetMatchEnabled: false,
    thirdPlaceMatch: false, wrestlebackDepth: 'full',
    rrWithdrawalPolicy: 'A', rrDiffCap: 15, overtime: 'usaw-draft',
  }),
  draftPreset('aau-2026', 'AAU', '2026', {
    scoring: { ...BASE_SCORING, takedown: 2, nearFall4: 3 }, techFallContinuation: true, periods: 3,
    periodLengthSec: 90, restFloorMin: 15, restWaivableInWriting: true,
    boutCapPerDay: 5, placementDepth: 4, headgear: 'required',
    challengeBrick: false, consolationChallenge: true,
    resetMatchEnabled: false, thirdPlaceMatch: false,
    wrestlebackDepth: 'full', rrWithdrawalPolicy: 'A', rrDiffCap: 12,
    overtime: 'aau-draft',
  }),
  draftPreset('youth-local', 'LOCAL', 'house', {
    scoring: { ...BASE_SCORING, takedown: 2, nearFall4: 3 }, techFallContinuation: true, periods: 3,
    periodLengthSec: 60, restFloorMin: 20, boutCapPerDay: 5,
    placementDepth: 4, headgear: 'required', challengeBrick: false,
    consolationChallenge: true, resetMatchEnabled: false,
    thirdPlaceMatch: false, wrestlebackDepth: 'full',
    rrWithdrawalPolicy: 'A', rrDiffCap: 12, overtime: 'youth-draft',
  }),
];

export function getPreset(id) {
  const p = RULE_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown rules preset: ${id}`);
  return p;
}

/** Only the project owner marks a preset validated, after checking the source. */
export function validatePreset(id, { ownerKey, sourceDoc }) {
  if (ownerKey !== process.env.PROJECT_OWNER_KEY || !ownerKey) {
    throw new Error('only the project owner can validate a preset');
  }
  const p = getPreset(id);
  p.validationStatus = 'validated';
  p.validatedBy = 'project-owner';
  p.validatedAt = new Date().toISOString();
  p.sourceDoc = sourceDoc || '';
  p.lastReviewed = p.validatedAt;
  return p;
}

const EDITABLE_FIELDS = [
  'scoring', 'techFallContinuation', 'periods', 'periodLengthSec', 'restFloorMin', 'boutCapPerDay',
  'placementDepth', 'headgear', 'challengeBrick', 'consolationChallenge',
  'resetMatchEnabled', 'thirdPlaceMatch', 'wrestlebackDepth',
  'rrWithdrawalPolicy', 'rrDiffCap', 'overtime', 'restWaivableInWriting',
  'divisionMode', 'maxWeightSpread', 'madisonSize',
];

/** Validate a tournament ruleset. Returns { ok, warnings[], errors[] }. */
export function validateConfig(values, preset) {
  const warnings = [];
  const errors = [];
  if (preset.validationStatus !== 'validated') {
    warnings.push(`Preset "${preset.id}" (${preset.source} ${preset.edition}) is DRAFT/unverified — not official. Verify against the source before finalizing.`);
  }
  if (!(values.restFloorMin > 0)) errors.push('restFloorMin must be > 0 minutes');
  if (!(values.boutCapPerDay > 0)) errors.push('boutCapPerDay must be > 0');
  if (values.thirdPlaceMatch && values.consolationChallenge) {
    errors.push('thirdPlaceMatch requires consolationChallenge=false: in true double-elimination there is no valid 3rd-place pairing (consolation-final loser takes 3rd).');
  }
  if (values.resetMatchEnabled && !values.consolationChallenge) {
    errors.push('resetMatchEnabled requires consolationChallenge=true.');
  }
  for (const [k, v] of Object.entries(values.scoring || {})) {
    if (typeof v !== 'number' || v < 0) errors.push(`scoring.${k} must be a non-negative number`);
  }
  return { ok: errors.length === 0, warnings, errors };
}

/** Create a tournament-specific ruleset: copies preset values, never live state. */
export function createTournamentConfig(db, { presetId, overrides = {}, actor = 'organizer' }) {
  const preset = getPreset(presetId);
  const values = JSON.parse(JSON.stringify(preset.values));
  const appliedOverrides = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (!EDITABLE_FIELDS.includes(k)) throw new Error(`field not editable: ${k}`);
    values[k] = v;
    appliedOverrides[k] = v;
  }
  const check = validateConfig(values, preset);
  if (!check.ok) throw new Error(`invalid config: ${check.errors.join('; ')}`);
  const config = {
    presetId: preset.id, presetSource: preset.source, presetEdition: preset.edition,
    presetStatus: preset.validationStatus, values, version: 1, frozen: false,
    warnings: check.warnings,
  };
  audit(db, { actor, action: 'config.created', payload: { presetId, overrides: appliedOverrides, warnings: check.warnings } });
  return config;
}

/** Freeze at finalization. Later changes need the correction workflow. */
export function freezeConfig(db, tournament, actor) {
  tournament.config.frozen = true;
  audit(db, { tournamentId: tournament.id, actor, action: 'config.frozen', payload: { version: tournament.config.version } });
}

export function correctConfig(db, tournament, overrides, { actor, reason }) {
  if (!reason) throw new Error('correction workflow requires a reason');
  const preset = getPreset(tournament.config.presetId);
  const values = { ...tournament.config.values };
  for (const [k, v] of Object.entries(overrides)) {
    if (!EDITABLE_FIELDS.includes(k)) throw new Error(`field not editable: ${k}`);
    values[k] = v;
  }
  const check = validateConfig(values, preset);
  if (!check.ok) throw new Error(`invalid correction: ${check.errors.join('; ')}`);
  tournament.config.values = values;
  tournament.config.version += 1;
  tournament.config.warnings = check.warnings;
  audit(db, {
    tournamentId: tournament.id, actor, action: 'config.corrected',
    payload: { overrides, reason, version: tournament.config.version },
  });
  return tournament.config;
}

export function newTournamentId() { return newId(); }
