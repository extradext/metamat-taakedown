// interfaces.js — Stable provider/store interfaces. Defined before any UI.
// Bracket decisions are made ONLY by BracketEngine. AI output is input to
// validation, never a decision. Mock providers exist ONLY behind
// USE_REAL_META_AI=false and are always labelled honestly.
function unimpl(name) {
  throw new Error(`not implemented: ${name}`);
}

export class TournamentConfigStore {
  async get(_tournamentId) { unimpl('TournamentConfigStore.get'); }
  async save(_tournamentId, _config, _actor) { unimpl('TournamentConfigStore.save'); }
}

export class BracketEngine {
  generate(_division) { unimpl('BracketEngine.generate'); }
  recordResult(_bracket, _matchId, _result) { unimpl('BracketEngine.recordResult'); }
  standings(_bracket) { unimpl('BracketEngine.standings'); }
}

// Model renders ART ONLY. Template renders all text/stats/names/numbers.
export class CardArtProvider {
  constructor() { this.label = 'unbound'; this.isMock = true; }
  async generateArt(_artPrompt) { unimpl('CardArtProvider.generateArt'); }
}

// Explanations + setup proposals. Every output is validated by deterministic
// code before display or commit. Never a bracket decision.
export class AiAssistantProvider {
  constructor() { this.label = 'unbound'; this.isMock = true; }
  async proposeRuleProfile(_naturalLanguage) { unimpl('AiAssistantProvider.proposeRuleProfile'); }
  async explain(_context) { unimpl('AiAssistantProvider.explain'); }
}

export class WrestlerStore {
  async create(_fields) { unimpl('WrestlerStore.create'); }
  async get(_id) { unimpl('WrestlerStore.get'); }
  async findByShortId(_shortId) { unimpl('WrestlerStore.findByShortId'); }
}

export class TournamentStore {
  async create(_fields) { unimpl('TournamentStore.create'); }
  async get(_id) { unimpl('TournamentStore.get'); }
}

export class KudosStore {
  async give(_tournamentId, _giverAccountId, _wrestlerId) { unimpl('KudosStore.give'); }
  async tallies(_tournamentId) { unimpl('KudosStore.tallies'); }
}

export class NotesStore {
  async add(_note) { unimpl('NotesStore.add'); }
  async listForWrestler(_tournamentId, _wrestlerId, _viewer) { unimpl('NotesStore.listForWrestler'); }
}

export class GuardianLinkStore {
  async request(_wrestlerId, _accountId) { unimpl('GuardianLinkStore.request'); }
  async approve(_wrestlerId, _accountId, _approver) { unimpl('GuardianLinkStore.approve'); }
}

export const INTERFACE_NAMES = [
  'TournamentConfigStore', 'BracketEngine', 'CardArtProvider',
  'AiAssistantProvider', 'WrestlerStore', 'TournamentStore',
  'KudosStore', 'NotesStore', 'GuardianLinkStore',
];
