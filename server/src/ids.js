// ids.js — Permanent identity (R2). The authoritative ID is an opaque random
// UUID, never derived from personal data. The short display ID is a persisted
// lookup convenience only: unique, issued once, never changed, never auth.
import { randomUUID } from 'node:crypto';

export const SHORT_ID_START = 1001;

export function newId() {
  return randomUUID();
}

/** Format a short display ID with configurable prefix/suffix (scales past 9,999). */
export function formatShortId(seq, { prefix = '', suffix = '' } = {}) {
  return `${prefix}${seq}${suffix}`;
}

/** Next free numeric sequence given a Set of taken formatted IDs and options. */
export function nextShortId(taken, opts = {}) {
  let seq = SHORT_ID_START;
  while (taken.has(formatShortId(seq, opts))) seq += 1;
  return { seq, shortId: formatShortId(seq, opts) };
}
