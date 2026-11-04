// meta.js — Meta Model API wiring, VERIFIED against Meta's current docs at
// build time (checked 2026-10-30, https://dev.meta.ai/docs/models,
// /media-segmentation, /sam/overview, /pricing-rate-limits):
//   base https://api.meta.ai/v1, Bearer MODEL_API_KEY, OpenAI-compatible.
// Versioned model IDs below are used EXACTLY as documented (spec: use them
// when the docs give them). Env overrides still win when docs change.
// The API key comes from an env var, never the repo/logs.
//   USE_REAL_META_AI=true   -> real Meta calls (fails loudly if misconfigured)
//   USE_REAL_META_AI=false  -> labelled local mock for dev without a key ONLY
import { CardArtProvider, AiAssistantProvider } from './interfaces.js';
import { validateConfig, getPreset } from './rules.js';

export const META_DOCS = {
  base: 'https://api.meta.ai/v1',
  checked: '2026-10-30',
  source: 'https://dev.meta.ai/docs/models (+ /media-segmentation, /sam/overview, /pricing-rate-limits)',
};

// Exactly as documented. Standard-mode IDs (content NOT used for training —
// the right default for an app used by children). Contributor-mode IDs are
// never selected here.
export const DOC_MODEL_IDS = {
  image: 'muse-image-1.0',
  wonder: 'muse-wonder-1.0',
  spark: 'muse-spark-1.3',
  sam: 'sam-3.1',
  voice: 'muse-voice-transcribe-1.0',
};

export const META_ENV = {
  flag: 'USE_REAL_META_AI',
  key: 'META_MODEL_API_KEY', // or MODEL_API_KEY (docs name); either works
  altKey: 'MODEL_API_KEY',
  base: 'META_MODEL_API_BASE_URL', // verified default when unset
  imageModel: 'META_MODEL_IMAGE',
  wonderModel: 'META_MODEL_WONDER',
  sparkModel: 'META_MODEL_SPARK',
  samModel: 'META_MODEL_SAM',
  voiceModel: 'META_MODEL_VOICE',
};

// Friendly display names for UI copy (never sent as model IDs).
export const GUIDE_MODELS = {
  image: 'Muse Image',
  wonder: 'Muse Wonder',
  spark: 'Muse Spark',
  sam: 'SAM 3.1',
};

export function useRealMeta(env = process.env) {
  return env[META_ENV.flag] === 'true';
}

export function modelId(kind, env = process.env) {
  const key = META_ENV[`${kind}Model`];
  return env[key] || DOC_MODEL_IDS[kind];
}

export function baseUrl(env = process.env) {
  return (env[META_ENV.base] || META_DOCS.base).replace(/\/$/, '');
}

/** Full request URL. Paths are base-relative: the base already ends in /v1,
 *  so call sites pass '/images/generations', never '/v1/...' — a doubled
 *  /v1/v1/... path 404s on the live API. */
export function metaUrl(env = process.env, path) {
  return `${baseUrl(env)}${path}`;
}

export function apiKey(env = process.env) {
  return env[META_ENV.key] || env[META_ENV.altKey] || null;
}

/** Loud configuration check for the real path. Never throws for mock mode. */
export function checkRealConfig(env = process.env) {
  const missing = [];
  if (!apiKey(env)) missing.push(`${META_ENV.key} or ${META_ENV.altKey} (Meta Model API key, env only — never in code)`);
  return {
    ok: missing.length === 0,
    missing,
    base: baseUrl(env),
    models: {
      image: modelId('image', env), wonder: modelId('wonder', env),
      spark: modelId('spark', env), sam: modelId('sam', env),
      voice: modelId('voice', env),
    },
  };
}

function loudError(check) {
  return new Error(
    `Real Meta calls requested (USE_REAL_META_AI=true) but misconfigured. Missing: ${check.missing.join('; ')}. ` +
    `Set them as environment variables (never in code). Base: ${check.base}. ` +
    `Model identifiers in use: ${JSON.stringify(check.models)} (verified ${META_DOCS.checked}; ` +
    `override via ${META_ENV.imageModel}/${META_ENV.wonderModel}/${META_ENV.sparkModel}/${META_ENV.samModel}/${META_ENV.voiceModel} exactly as documented if docs change).`,
  );
}

// Simple FIFO queue so generation bursts never hammer the live scoring path.
// Concurrency is configurable; request-rate figures come from current docs at
// build time and are NOT hard-coded here as fact.
function createQueue(concurrency = 2) {
  const pending = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && pending.length) {
      const { fn, resolve, reject } = pending.shift();
      active += 1;
      fn().then((v) => { active -= 1; resolve(v); pump(); },
        (e) => { active -= 1; reject(e); pump(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { pending.push({ fn, resolve, reject }); pump(); });
}
const metaQueue = createQueue(Number(process.env.META_QUEUE_CONCURRENCY || 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Transport-only POST (OpenAI-compatible shape) to the Meta Model API. */
async function metaPost(env, path, body) {
  const check = checkRealConfig(env);
  if (!check.ok) throw loudError(check);
  const send = () => fetch(metaUrl(env, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey(env)}` },
    body: JSON.stringify(body),
  });
  let res = await send();
  // Rate limits are per-team, per-model (docs); figures are NOT hard-coded
  // here — honor the server's Retry-After once, then fail loudly.
  if (res.status === 429) {
    const wait = Math.min(60000, (Number(res.headers.get('retry-after')) || 5) * 1000);
    await sleep(wait);
    res = await send();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const model = body && body.model ? body.model : 'n/a';
    throw new Error(`Meta Model API POST ${metaUrl(env, path)} (model ${model}) failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ---------- Card art: template renders text, model renders ART ONLY ----------
// Named card presets. Each preset is a DISTINCT art-layer prompt set — pose,
// background, palette, finish, and energy — never a border-colour swap. One
// table drives Parent CREATE and Demo Regenerate; the questionnaire maps
// answers onto these ids, and 'mystery' resolves to a random preset per
// variant (never a fixed rotation).
export const CARD_PRESETS = {
  classic: { name: 'Classic', pose: 'heroic championship pose, standing tall with arms raised', background: 'bright arena light, clean stadium crowd', palette: 'bold primary sports colors', finish: 'clean matte sports-card finish', energy: 'proud heroic energy' },
  'shiny-glittery': { name: 'Shiny Glittery', pose: 'joyful victory pose, confetti in the air', background: 'sparkling celebration stage, bright lights', palette: 'bright celebratory pastels with gold', finish: 'foil sparkle holographic finish', energy: 'bright celebratory energy' },
  fire: { name: 'Fire', pose: 'fierce lunging pose, fists forward', background: 'roaring flame background, drifting embers', palette: 'warm palette: red, orange, gold', finish: 'molten foil finish', energy: 'fierce fiery energy' },
  ice: { name: 'Ice', pose: 'sharp crystalline stance, one arm extended', background: 'frost background, glittering ice crystals', palette: 'cool palette: ice blue, white, silver', finish: 'frosted foil finish', energy: 'calm razor-sharp energy' },
  lightning: { name: 'Lightning', pose: 'dynamic mid-action sprint pose', background: 'storm background, crackling lightning bolts', palette: 'electric violet, yellow, deep blue', finish: 'charged electric foil finish', energy: 'explosive storm energy' },
  attack: { name: 'Attack', pose: 'aggressive forward takedown drive pose', background: 'dusty arena mat, speed lines', palette: 'hot red and black', finish: 'high-impact gloss finish', energy: 'aggressive forward energy' },
  'brick-wall': { name: 'Brick-Wall Defense', pose: 'solid guard stance, arms crossed low, grounded', background: 'ancient stone fortress wall', palette: 'granite gray, bronze, deep green', finish: 'brushed metal finish', energy: 'immovable grounded energy' },
  'super-silly': { name: 'Super Silly', pose: 'playful goofy pose, tongue out, mid-bounce', background: 'carnival gym, balloons and streamers', palette: 'bright candy palette', finish: 'glossy sticker finish', energy: 'funny bouncy energy' },
  friendly: { name: 'Friendly', pose: 'warm smiling wave pose', background: 'sunny school gym, cheering bunting', palette: 'warm welcoming yellows and greens', finish: 'soft satin finish', energy: 'kind welcoming energy' },
  fierce: { name: 'Fierce', pose: 'intense staredown pose, fists clenched', background: 'dark smoky arena, single spotlight', palette: 'bold palette: crimson, black, gold', finish: 'high-contrast gloss finish', energy: 'intense competitive energy' },
  'a-little-scary': { name: 'A Little Scary', pose: 'dramatic cartoon shadow pose, glowing friendly eyes', background: 'dark arena light, silver moonbeams', palette: 'midnight blue, purple, silver', finish: 'shadow foil finish', energy: 'dramatic spooky-but-friendly energy, always kid-friendly' },
};
export const CARD_PRESET_IDS = Object.keys(CARD_PRESETS);
// Legacy style names (old answers, milestone and seed calls) map onto presets.
const STYLE_PRESET = {
  classic: 'classic', shiny: 'shiny-glittery', 'shiny-glittery': 'shiny-glittery',
  fire: 'fire', ice: 'ice', lightning: 'lightning', photo: 'classic',
  milestone: 'shiny-glittery', full: 'classic',
};
/** Resolve a preset id. 'mystery'/'shuffle' picks randomly per call (the
 *  caller passes one call per variant); unknown ids fall back to classic.
 *  `rand` is injectable so tests stay deterministic. */
export function pickPreset(id, rand = Math.random) {
  if (id === 'mystery' || id === 'shuffle') return CARD_PRESET_IDS[Math.floor(rand() * CARD_PRESET_IDS.length)];
  if (CARD_PRESETS[id]) return id;
  return STYLE_PRESET[String(id || '').toLowerCase()] || 'classic';
}
// Per-variant scene-light words so one event's variants differ by parameters
// even when they share answers and preset.
export const VARIANT_WORDS = ['sunrise glow', 'crowd roar', 'night lights', 'golden hour'];

export function buildArtPrompt({ answers = {}, hero = 'hero', preset = null, variantWord = '' } = {}) {
  const pid = pickPreset(preset || answers.preset || answers.style || 'classic');
  const p = CARD_PRESETS[pid];
  const parts = [
    'Epic youth sports trading-card monster-hero illustration, no text.',
    `Preset ${p.name}: ${p.pose}. ${p.background}. ${p.palette}. ${p.finish}. ${p.energy}.`,
    `Hero: ${hero}.`,
  ];
  if (answers.color) parts.push(`Favorite color energy: ${answers.color}.`);
  if (answers.animal) parts.push(`Animal spirit: ${answers.animal}.`);
  if (answers.world) parts.push(`World: ${answers.world}.`);
  if (answers.finish) parts.push(`Extra finish note: ${answers.finish}.`);
  if (variantWord) parts.push(`Scene light: ${variantWord}.`);
  parts.push('STRICT: no text, no letters, no numbers, no words, no logos, no watermarks, no signatures.');
  return parts.join(' ');
}

export class MetaCardArtProvider extends CardArtProvider {
  constructor(env = process.env) {
    super();
    this.env = env;
    this.isMock = !useRealMeta(env);
    this.label = this.isMock ? 'mock-art (local dev fallback — NOT Meta)' : `meta:${modelId('image', env)}`;
  }
  async generateArt({ prompt }) {
    if (this.isMock) return mockArt(prompt);
    const check = checkRealConfig(this.env);
    if (!check.ok) throw loudError(check);
    const model = modelId('image', this.env);
    // Slot separation: a text-model ID must never ride the image route. The
    // image call sends the image slot only (default muse-image-1.0); text IDs
    // stay on text routes. A crossed slot fails here, naming the exact model.
    const textIds = [modelId('wonder', this.env), modelId('spark', this.env)];
    if (textIds.includes(model)) {
      throw new Error(`Refusing image call: '${model}' is a text model ID and text IDs stay on text routes. Image calls use '${DOC_MODEL_IDS.image}' (slot ${META_ENV.imageModel}). Nothing was made.`);
    }
    return metaQueue(async () => {
      const data = await metaPost(this.env, '/images/generations', { model, prompt, n: 1 });
      const url = data?.data?.[0]?.url || data?.data?.[0]?.b64_json;
      if (!url) throw new Error('Meta Image returned no art payload');
      return { art: url, provider: this.label, isMock: false };
    });
  }
}

/** Honestly-labelled local fallback: procedural SVG art. NEVER shipped as real.
 *  The placeholder is a wrestler silhouette in an action pose filling the
 *  frame — never an empty shape, and never any text (the image layer never
 *  renders text; the template renders that). */
export function mockArt(prompt) {
  const hue = [...String(prompt)].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="360">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue},80%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},85%,35%)"/>`
    + `</linearGradient><linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="rgba(255,255,255,.30)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>`
    + `</linearGradient></defs><rect width="500" height="360" fill="url(#g)"/>`
    + `<polygon points="120,0 200,0 90,360 10,360" fill="url(#beam)"/>`
    + `<polygon points="310,0 360,0 400,360 330,360" fill="url(#beam)"/>`
    + `<ellipse cx="250" cy="330" rx="170" ry="22" fill="rgba(0,0,0,.30)"/>`
    + `<g stroke="rgba(8,10,14,.92)" stroke-width="34" stroke-linecap="round" fill="none">`
    + `<path d="M258 148 L232 222 L172 288"/><path d="M258 148 L296 210 L352 236"/>`
    + `<path d="M258 158 L184 178 L138 150"/><path d="M258 158 L330 172 L372 140"/></g>`
    + `<g stroke="rgba(255,255,255,.28)" stroke-width="7" stroke-linecap="round" fill="none">`
    + `<path d="M266 148 L240 222 L180 288"/><path d="M266 158 L338 172 L380 140"/></g>`
    + `<circle cx="262" cy="112" r="33" fill="rgba(8,10,14,.92)"/>`
    + `<path d="M244 92 a33 33 0 0 1 26 -12" stroke="rgba(255,255,255,.35)" stroke-width="6" fill="none" stroke-linecap="round"/>`
    + `</svg>`;
  return {
    art: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    provider: 'mock-art (local dev fallback — NOT Meta)', isMock: true,
  };
}

// Plain-words translation of a live Meta call failure for demo regeneration.
// Never includes key material. Order matters: most specific match first.
export function describeMetaFailure(err) {
  const raw = String(err?.message || err || 'unknown error');
  const low = raw.toLowerCase();
  if (/misconfigured|missing.*key|api key|unauthorized| 401/.test(low)) {
    return 'Live art failed: missing Meta API key. Set META_MODEL_API_KEY (or MODEL_API_KEY) as an environment variable and retry — nothing was made.';
  }
  if (/402|billing|payment|card declined|invoice/.test(low)) {
    return 'Live art failed: a billing problem on the Meta account (card or payment). Fix billing and retry — nothing was made.';
  }
  if (/429|quota|credit|rate limit|insufficient/.test(low)) {
    return 'Live art failed: no credits left or the request limit was hit. Check the Meta plan balance and retry later — nothing was made.';
  }
  if (/model|not found| 404|invalid|unsupported/.test(low)) {
    return `Live art failed: the model call was rejected (${raw.slice(0, 160)}). Nothing was made.`;
  }
  return `Live art failed: model error (${raw.slice(0, 160)}). Nothing was made.`;
}

// ---------- Muse Wonder (primary): NL setup -> VALIDATED rule profile ----------
const KNOWN_PRESETS = ['nfhs-2024-25', 'ncaa-2024-25', 'usaw-2025-26', 'aau-2026', 'youth-local'];

export function validateProposedProfile(proposed) {
  // Deterministic validation. Wonder proposes; CODE validates and commits.
  const errors = [];
  if (!proposed || typeof proposed !== 'object') return { ok: false, errors: ['empty proposal'] };
  const presetId = KNOWN_PRESETS.includes(proposed.presetId) ? proposed.presetId : 'youth-local';
  const preset = getPreset(presetId);
  const values = { ...preset.values, ...(proposed.overrides || {}) };
  const check = validateConfig(values, preset);
  return {
    ok: check.ok, errors: check.errors, warnings: check.warnings,
    profile: check.ok ? { presetId, overrides: proposed.overrides || {}, values } : null,
  };
}

/** Mock Wonder: keyword parser for local dev. Labelled mock, same validator. */
export function mockWonderParse(text) {
  const t = String(text || '').toLowerCase();
  const overrides = {};
  const rest = t.match(/(\d+)\s*(min|minute)/);
  if (rest) overrides.restFloorMin = Number(rest[1]);
  if (t.includes('ncaa')) return { presetId: 'ncaa-2024-25', overrides };
  if (t.includes('nfhs') || t.includes('high school')) return { presetId: 'nfhs-2024-25', overrides };
  if (t.includes('usaw') || t.includes('usa wrestling') || t.includes('freestyle')) return { presetId: 'usaw-2025-26', overrides };
  if (t.includes('aau')) return { presetId: 'aau-2026', overrides };
  if (t.includes('tech fall 15') || t.includes('tech 15')) overrides.rrDiffCap = 15;
  if (t.includes('no reset') || t.includes('without reset')) overrides.resetMatchEnabled = false;
  if (t.includes('reset match') || t.includes('true second')) overrides.resetMatchEnabled = true;
  return { presetId: 'youth-local', overrides };
}

export class MetaWonderProvider extends AiAssistantProvider {
  constructor(env = process.env) {
    super();
    this.env = env;
    this.isMock = !useRealMeta(env);
    this.label = this.isMock ? 'mock-wonder (local dev fallback — NOT Meta)' : `meta:${modelId('wonder', env)}`;
  }
  async proposeRuleProfile(naturalLanguage) {
    if (this.isMock) {
      const proposed = mockWonderParse(naturalLanguage);
      const validated = validateProposedProfile(proposed);
      return { proposed, ...validated, provider: this.label, isMock: true };
    }
    const check = checkRealConfig(this.env);
    if (!check.ok) throw loudError(check);
    const model = modelId('wonder', this.env);
    const data = await metaQueue(() => metaPost(this.env, '/chat/completions', {
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Convert folkstyle tournament setup prose into JSON: {"presetId": one of nfhs-2024-25|ncaa-2024-25|usaw-2025-26|aau-2026|youth-local, "overrides": {restFloorMin?, boutCapPerDay?, resetMatchEnabled?, ...}}. Output JSON only.' },
        { role: 'user', content: String(naturalLanguage) },
      ],
    }));
    const raw = data?.choices?.[0]?.message?.content || '{}';
    let proposed;
    try { proposed = JSON.parse(raw); } catch { proposed = mockWonderParse(raw); }
    const validated = validateProposedProfile(proposed);
    return { proposed, ...validated, provider: this.label, isMock: false };
  }
  async explain(context) {
    // Wonder is the setup model; explanations route to Spark (documented).
    const spark = new MetaSparkProvider(this.env);
    return spark.explain(context);
  }
}

// ---------- Muse Spark: prompt structuring + plain-language explanations ----------
// Validated by deterministic code before display. Documented fallback for
// explanations only — never a silent swap for Wonder/Image decisions.
export class MetaSparkProvider {
  constructor(env = process.env) {
    this.env = env;
    this.isMock = !useRealMeta(env);
    this.label = this.isMock ? 'mock-spark (local dev fallback — NOT Meta)' : `meta:${modelId('spark', env)}`;
  }
  async explain({ kind, facts }) {
    const validated = buildExplanation(kind, facts); // deterministic, always
    if (this.isMock) return { ...validated, provider: this.label, isMock: true };
    const check = checkRealConfig(this.env);
    if (!check.ok) throw loudError(check);
    const model = modelId('spark', this.env);
    const data = await metaQueue(() => metaPost(this.env, '/chat/completions', {
      model,
      messages: [
        { role: 'system', content: 'Rewrite these wrestling-tournament facts as one warm plain-language sentence for a parent. Never add advice, never mention scores you were not given.' },
        { role: 'user', content: validated.text },
      ],
    }));
    const text = data?.choices?.[0]?.message?.content?.trim() || validated.text;
    return { kind, facts, text, provider: this.label, isMock: false, validatedAgainst: validated.text };
  }
  structureArtPrompt(answers, hero) {
    // Prompt structuring for card art (deterministic template).
    return buildArtPrompt({ answers, hero });
  }
}

/** Deterministic explanation builder — the validated source of truth. */
export function buildExplanation(kind, facts = {}) {
  if (kind === 'rest-hold') {
    return {
      kind, facts,
      text: `HELD on rest: ${facts.name || 'this wrestler'} finished a bout ${facts.restedMin ?? '?'} minutes ago and needs ${facts.restFloorMin ?? '?'} minutes between bouts. Up in about ${facts.needsMin ?? '?'} minutes.`,
    };
  }
  if (kind === 'seeding-flag') {
    return {
      kind, facts,
      text: `Seeding check: ${facts.message || 'a head-to-head result disagrees with the seed order'}. An organizer will review it — nothing changes on its own.`,
    };
  }
  if (kind === 'mismatch') {
    return {
      kind, facts,
      text: `Grouping note: ${facts.message || 'these wrestlers have very different competitive histories'}. The organizer decides the final groups.`,
    };
  }
  return { kind, facts, text: 'Here is what the tournament record shows.' };
}

// ---------- SAM 3.1: photo background cut-out ONLY, when wiring exists ----------
// Verified shape (docs /sam/overview): POST /v1/responses, model sam-3.1,
// one user message with input_text noun phrase + input_image part.
// Response carries boxes+masks in output_text (documented grammar).
export function parseSamBoxes(outputText) {
  const boxes = [];
  const re = /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g;
  let m;
  while ((m = re.exec(String(outputText || ''))) !== null) {
    boxes.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], w: +m[5], h: +m[6] });
  }
  return boxes;
}

export async function samCutout(photoDataUrl, env = process.env) {
  if (!useRealMeta(env)) {
    return {
      ok: false, reason: 'mock-mode',
      message: 'Background cut-out arrives with SAM 3.1 wiring. Your photo is framed unaltered for now.',
      photo: photoDataUrl,
    };
  }
  const check = checkRealConfig(env);
  if (!check.ok) {
    return {
      ok: false, reason: 'not-configured',
      message: `SAM 3.1 wiring is not configured yet (missing: ${check.missing.join('; ')}). Your photo is framed unaltered — never AI-regenerated to fake a cut-out.`,
      photo: photoDataUrl,
    };
  }
  // Wiring exists: SAM returns geometry (boxes + masks) for compositing.
  // Mask-only; the child's photo pixels are never regenerated.
  const model = modelId('sam', env);
  try {
    const data = await metaQueue(() => metaPost(env, '/responses', {
      model,
      input: [{ type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'child' },
        { type: 'input_image', image_url: photoDataUrl },
      ] }],
    }));
    const text = data?.output_text || JSON.stringify(data).slice(0, 2000);
    return {
      ok: true, provider: `meta:${model}`, boxes: parseSamBoxes(text),
      raw: String(text).slice(0, 4000), photo: photoDataUrl,
      note: 'Geometry only — composite client-side; full raster decode uses @meta-sam/parser in production.',
    };
  } catch (err) {
    return { ok: false, reason: 'call-failed', message: `SAM 3.1 call failed (${err.message}). Photo framed unaltered.`, photo: photoDataUrl };
  }
}

// ---------- Voice Transcribe (optional): captions / voice notes ONLY ----------
export async function voiceTranscribe(audioRef, env = process.env) {
  if (!useRealMeta(env)) {
    return { ok: false, reason: 'mock-mode', message: 'Voice captions arrive with Meta wiring; voice notes stay as audio for now.' };
  }
  // Verified endpoint (docs): POST /v1/asr/transcribe, model
  // muse-voice-transcribe-1.0. Audio-upload shape not yet wired in this build.
  return {
    ok: false, reason: 'not-configured',
    message: 'Voice Transcribe endpoint verified (POST /v1/asr/transcribe) but audio upload is not wired in this build — voice notes stay as audio. Never a required path.',
  };
}

// ---------- Honest provider status for the Architecture / About view ----------
export function providerStatus(env = process.env) {
  const real = useRealMeta(env);
  const check = checkRealConfig(env);
  return {
    mode: real ? 'real' : 'mock',
    flag: `${META_ENV.flag}=${real}`,
    keyPresent: !!apiKey(env),
    base: baseUrl(env),
    docsChecked: META_DOCS.checked,
    missing: real ? check.missing : [],
    models: check.models,
    note: real
      ? 'Real Meta Model API path (Standard-mode IDs). All AI calls go to Meta models only.'
      : 'Local development fallback. Mock providers are NEVER shipped as real Meta calls.',
  };
}
