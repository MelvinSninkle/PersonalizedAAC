// Session token helpers — HMAC-signed cookie, no DB lookup needed to verify.
// Written with Web Crypto + base64url so the SAME code runs in both the Edge
// middleware and the Node serverless functions. The secret is SESSION_SECRET.

const COOKIE = 'mw_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(payload, secret) {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return body + '.' + b64urlEncode(sig);
}

export async function verifySession(token, secret) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const key = await hmacKey(secret);
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(dec.decode(b64urlDecode(body))); } catch { return null; }
  if (!payload || (payload.exp && Date.now() > payload.exp)) return null;
  return payload;
}

export function cookieName() { return COOKIE; }

export function serializeCookie(token, { maxAge = MAX_AGE, clear = false } = {}) {
  return [
    `${COOKIE}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    `Max-Age=${clear ? 0 : maxAge}`,
  ].join('; ');
}

export function parseCookies(header) {
  const out = {};
  (header || '').split(/;\s*/).forEach((pair) => {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1);
  });
  return out;
}

export const SESSION_MAX_AGE = MAX_AGE;
