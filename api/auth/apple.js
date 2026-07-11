// POST /api/auth/apple { identityToken, authorizationCode?, fullName?, email?, slug? }
//
// Sign in with Apple. The iOS / web client passes Apple's identity token
// (a JWT signed by Apple's RS256 keys). We verify it against
// https://appleid.apple.com/auth/keys, check the issuer + audience + expiry,
// then sign in or create an account keyed by the JWT's `sub` claim (Apple's
// stable per-app user id — never changes even if the user revokes their
// private-relay email).
//
// `fullName` and `email` are sent by Apple ONLY on first authorization. We
// store the email opportunistically; on a re-sign-in Apple won't repeat it,
// which is correct (the apple_user_id is the durable identity).
//
// Sets the same `mw_session` cookie /api/auth/login does, so the rest of
// the app sees a SIWA user as just a logged-in user.
import { createPublicKey, createVerify } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { signSession, serializeCookie, SESSION_MAX_AGE } from '../../lib/session.js';

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER   = 'https://appleid.apple.com';

// Apple's bundle/service identifier. iOS apps and web pass DIFFERENT aud
// claims (the native bundle id for the iOS app; the Services ID for web).
// We accept both via the env var, comma-separated, so the same endpoint
// serves both clients.
function audienceList() {
  const raw = process.env.APPLE_AUDIENCES || process.env.APNS_BUNDLE_ID || 'io.andrewpeterson.myworld';
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

// JWKS lookup with a 1-hour in-memory cache. Apple rotates these keys
// occasionally so we don't pin a single one.
let jwksCache = { fetchedAt: 0, keys: [] };
async function fetchAppleKeys() {
  const fresh = Date.now() - jwksCache.fetchedAt < 60 * 60 * 1000;
  if (fresh && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch(APPLE_JWKS_URL);
  if (!r.ok) throw new Error(`Apple JWKS fetch failed: ${r.status}`);
  const data = await r.json();
  jwksCache = { fetchedAt: Date.now(), keys: data.keys || [] };
  return jwksCache.keys;
}

function base64UrlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

// Verifies an Apple ID JWT (RS256) and returns the decoded claims, or null.
async function verifyAppleToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;
  const keys = await fetchAppleKeys();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const pubKey = createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  if (!verifier.verify(pubKey, sigB64, 'base64url')) return null;
  // Claims.
  if (payload.iss !== APPLE_ISSUER) return null;
  if (typeof payload.exp !== 'number' || Date.now() / 1000 >= payload.exp) return null;
  const aud = audienceList();
  const claimedAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!claimedAud.some(a => aud.has(a))) return null;
  if (!payload.sub) return null;
  return payload;
}

// Slugify a name → 'andrewpeterson'. Same shape the rest of the app uses.
function slugify(s) {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const secret = process.env.SESSION_SECRET;
  if (!secret) { res.status(500).json({ error: 'Login is not configured (SESSION_SECRET not set).' }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const token = typeof b.identityToken === 'string' ? b.identityToken : '';
  if (!token) { res.status(400).json({ error: 'identityToken required' }); return; }

  const claims = await verifyAppleToken(token);
  if (!claims) { res.status(401).json({ error: 'Invalid Apple identity token' }); return; }

  const appleUserId = String(claims.sub);
  // Apple sends email + fullName ONLY on the very first authorization, so the
  // client passes through what it received. Email can also come from claims
  // for verified accounts. Trust order: client body > token claim.
  const emailFromClient = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const emailFromToken  = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const email = emailFromClient || emailFromToken || `${appleUserId}@privaterelay.appleid.com`;
  const fullName = (typeof b.fullName === 'string' && b.fullName.trim()) || null;
  const wantSlug = slugify(b.slug || fullName || email.split('@')[0]) || 'parent';

  try {
    const db = sql();
    // 1) Existing SIWA user?
    let created = false;
    let row = (await db`SELECT id, email, role, child_slug FROM users WHERE apple_user_id = ${appleUserId} LIMIT 1`)[0];

    // 2) If not, link to an existing email match (so a parent who registered
    //    with the same Apple-relay or real email keeps the same account).
    if (!row && email) {
      const byEmail = (await db`SELECT id, email, role, child_slug FROM users WHERE email = ${email} LIMIT 1`)[0];
      if (byEmail) {
        await db`UPDATE users SET apple_user_id = ${appleUserId} WHERE id = ${byEmail.id}`;
        row = byEmail;
      }
    }

    // 3) Fresh account. Pick a unique child_slug — fall back with a numeric
    //    suffix on collision.
    if (!row) {
      created = true;
      let slug = wantSlug;
      for (let i = 2; i < 1000; i++) {
        const taken = await db`SELECT 1 FROM users WHERE child_slug = ${slug} LIMIT 1`;
        if (!taken.length) break;
        slug = `${wantSlug}${i}`;
      }
      const inserted = await db`
        INSERT INTO users (email, password_hash, role, child_slug, apple_user_id, created_at)
        VALUES (${email}, '', 'parent', ${slug}, ${appleUserId}, NOW())
        RETURNING id, email, role, child_slug`;
      row = inserted[0];
      // Pre-authorized tester/therapist emails get their role from signup #1.
      try {
        const { applyRoleGrant } = await import('../_lib/role-grants.js');
        row = await applyRoleGrant(db, row);
      } catch (_) {}
    }

    const exp = Date.now() + SESSION_MAX_AGE * 1000;
    const tokenOut = await signSession(
      { uid: Number(row.id), email: row.email, role: row.role, slug: row.child_slug, exp },
      secret
    );
    res.setHeader('Set-Cookie', serializeCookie(tokenOut));
    try { await db`UPDATE users SET last_login_at = NOW() WHERE id = ${row.id}`; } catch (_) {}
    res.status(200).json({
      ok: true,
      created,                                            // true = brand-new account → continue onboarding
      user: { email: row.email, role: row.role, slug: row.child_slug },
    });
  } catch (err) {
    res.status(500).json({ error: 'Apple sign-in failed', detail: String(err.message || err) });
  }
}
