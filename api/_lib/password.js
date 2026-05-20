// Password hashing (Node-only — used by the auth endpoints, never the Edge
// middleware). scrypt with a per-password random salt; constant-time compare.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + key.toString('hex');
}

export function verifyPassword(pw, stored) {
  if (!stored || typeof stored !== 'string' || stored.indexOf(':') < 0) return false;
  const [saltHex, keyHex] = stored.split(':');
  let salt, key;
  try { salt = Buffer.from(saltHex, 'hex'); key = Buffer.from(keyHex, 'hex'); } catch { return false; }
  const test = scryptSync(pw, salt, key.length);
  return key.length === test.length && timingSafeEqual(key, test);
}

export function randomToken(n = 32) { return randomBytes(n).toString('hex'); }
