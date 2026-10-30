// encoding.js — Versioned, deterministic, reversible bracket-history encoding
// (A4). Structured match records are the AUTHORITATIVE source of truth; this
// service only converts them to a compact representation. Grammar changes
// never migrate or destroy history. v1: canonical JSON -> base64url + CRC.
import { createHash } from 'node:crypto';

export const ENCODING_VERSION = 'FWE1';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function crc8(str) {
  let crc = 0;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let b = 0; b < 8; b++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc.toString(16).padStart(2, '0');
}

function b64urlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** Encode structured bracket history. Deterministic: same record => same string. */
export function encodeHistory(record) {
  const canon = canonical({ v: 1, ...record });
  const body = b64urlEncode(canon);
  return `${ENCODING_VERSION}.${body}.${crc8(canon)}`;
}

/** Decode + verify checksum. Throws on corruption or version mismatch. */
export function decodeHistory(code) {
  const [ver, body, sum] = String(code).split('.');
  if (ver !== ENCODING_VERSION) throw new Error(`unsupported encoding version: ${ver}`);
  const canon = b64urlDecode(body);
  if (crc8(canon) !== sum) throw new Error('encoding checksum mismatch — record may be corrupted');
  return JSON.parse(canon);
}

/** Fingerprint linking an encoding to its authoritative structured record. */
export function recordFingerprint(record) {
  return createHash('sha256').update(canonical(record)).digest('hex');
}
