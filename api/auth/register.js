// POST /api/auth/register { email, password, role?, slug?, inviteToken?, selfSignup?, childName? }
// Three entry paths:
//   1. Admin-created: a signed-in admin (or the legacy ADMIN_TOKEN bearer)
//      creates or updates any user with any role. The bootstrap for the
//      very first admin is the legacy path.
//   2. Self-signup via invite: an anonymous visitor with a valid `inviteToken`
//      (HMAC-signed by /api/access/invite) creates their own account. The role
//      is forced to 'therapist'/'school_team'; the email is forced to the
//      one in the invite.
//   3. Open self-signup ({ selfSignup: true }): an anonymous parent creates
//      their own free account. Role is forced to 'parent'. We generate a child
//      slug from the child's name, link it via child_access (so the board is
//      theirs when the app is live), drop a session cookie, and send a welcome
//      email. An existing email is rejected (never silently password-reset).
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { hashPassword } from '../_lib/password.js';
import { signSession, serializeCookie, verifySession, SESSION_MAX_AGE } from '../../lib/session.js';
import { sendEmail, emailConfigured, escapeHtml } from '../_lib/email.js';
import { randomUUID } from 'node:crypto';

// 'school_team' = teacher / aide / school SLP. Peer of therapist for content
// ownership and canEditContent; presented separately in the parent's roster.
const ROLES = new Set(['admin', 'parent', 'therapist', 'school_team']);

function appUrl() {
  return process.env.APP_URL || process.env.PUBLIC_URL || 'https://aac.andrewpeterson.io';
}
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const body = (typeof req.body === 'object' && req.body) || {};
  const password = typeof body.password === 'string' ? body.password : '';
  const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken : '';
  if (password.length < 8) {
    res.status(400).json({ error: 'A password of at least 8 characters is required' });
    return;
  }

  // Path 3 — open parent self-signup (free). Fully self-contained: no admin,
  // no invite token. Role is forced to 'parent' so nobody can self-assign
  // elevated access through this endpoint.
  if (body.selfSignup === true && !inviteToken) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'A valid email is required' }); return;
    }
    // COPPA anchor: self-signup REQUIRES the consent box (guardian status,
    // 18+, Terms + Privacy, photo processing). Recorded with a version so a
    // future policy change can re-prompt. Old app builds without the field
    // are invite-path only, which is admin-vetted.
    if (body.consent !== true) {
      res.status(400).json({ error: 'consent_required', detail: 'Please accept the Terms, Privacy Policy, and photo-use consent.' }); return;
    }
    const childName = typeof body.childName === 'string' ? body.childName.trim().slice(0, 60) : '';
    try {
      const db = sql();
      await db`
        CREATE TABLE IF NOT EXISTS users (
          id BIGSERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'parent',
          child_slug TEXT,
          reset_token TEXT,
          reset_expires TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ
        )`;
      // Never silently overwrite an existing account's password — that would be
      // an account-takeover hole. Tell them to sign in instead.
      const dupe = await db`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
      if (dupe.length) {
        res.status(409).json({ error: 'An account with that email already exists. Please sign in.' }); return;
      }

      // Generate a board slug from the child's name (falls back to the email
      // local part), uniquified against both legacy child_slug and child_access.
      // Board slug from the child's name (fallback: email local part), numbered
      // for duplicates: sam, sam2, sam3, … Allocated RACE-SAFELY — a partial
      // UNIQUE index on child_slug is the real arbiter, and we retry with the
      // next number when a concurrent signup grabs the same one first. So two
      // people onboarding the same name at the same time can never share a slug.
      try { await db`CREATE UNIQUE INDEX IF NOT EXISTS users_child_slug_uidx ON users (child_slug) WHERE child_slug IS NOT NULL`; } catch (_) {}
      const base = slugify(childName) || slugify(email.split('@')[0]) || 'child';
      const taken = async (s) => {
        const a = await db`SELECT 1 FROM users WHERE child_slug = ${s} LIMIT 1`;
        if (a.length) return true;
        try { const b = await db`SELECT 1 FROM child_access WHERE child_id = ${s} LIMIT 1`; return b.length > 0; }
        catch (_) { return false; }
      };
      const hash = hashPassword(password);
      // Pre-pick a likely-free number to keep collisions rare; the retry loop is
      // what actually guarantees correctness under concurrency.
      let n = (await taken(base)) ? 2 : 1;
      let user = null, slug = base;
      for (let attempt = 0; attempt < 30 && !user; attempt++) {
        const candidate = n === 1 ? base : `${base}${n}`;
        try {
          const rows = await db`
            INSERT INTO users (email, password_hash, role, child_slug)
            VALUES (${email}, ${hash}, 'parent', ${candidate})
            RETURNING id, email, role, child_slug`;
          user = rows[0]; slug = candidate;
        } catch (e) {
          const msg = String((e && (e.message || e.detail)) || e);
          const isUnique = (e && e.code === '23505') || /duplicate key|unique constraint/i.test(msg);
          if (isUnique && /child_slug/i.test(msg)) { n = n < 2 ? 2 : n + 1; continue; }   // slug taken → next number
          if (isUnique) { res.status(409).json({ error: 'An account with that email already exists. Please sign in.' }); return; }  // email race
          throw e;
        }
      }
      if (!user) { res.status(500).json({ error: 'Could not allocate a board name — please try again.' }); return; }

      // Record the consent event (timestamp + policy version) with the account.
      try {
        await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ`;
        await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version TEXT`;
        const cv = typeof body.consentVersion === 'string' ? body.consentVersion.slice(0, 20) : '2026-07';
        await db`UPDATE users SET consented_at = NOW(), consent_version = ${cv} WHERE id = ${user.id}`;
      } catch (_) { /* consent columns are best-effort on legacy schemas */ }

      // Link the parent to their child's board (the source of truth for access
      // checks — isParentOf/canEditContent read child_access, not child_slug).
      try {
        await db`INSERT INTO child_access (user_id, child_id, relation, status)
                 VALUES (${user.id}, ${slug}, 'parent', 'active')
                 ON CONFLICT (user_id, child_id) DO NOTHING`;
      } catch (_) { /* table may not exist pre-init; backfill covers it later */ }

      // Seed the onboarding row with the child's name so Step 1 prefills it from
      // signup (the prior page) instead of starting blank.
      if (childName) {
        try {
          await db`INSERT INTO onboarding_progress (user_id, child_id, step, data)
                   VALUES (${Number(user.id)}, ${slug}, 'account', ${JSON.stringify({ childName })}::jsonb)
                   ON CONFLICT (user_id) DO UPDATE
                     SET data = COALESCE(onboarding_progress.data, '{}'::jsonb) || ${JSON.stringify({ childName })}::jsonb`;
        } catch (_) { /* table may not exist pre-init; onboarding will create it */ }
      }

      // Drop a session cookie so they walk straight into /onboard signed in.
      const secret = process.env.SESSION_SECRET;
      if (secret) {
        const exp = Date.now() + SESSION_MAX_AGE * 1000;
        const token = await signSession({ uid: Number(user.id), email: user.email, role: 'parent', slug, exp }, secret);
        res.setHeader('Set-Cookie', serializeCookie(token));
      }
      try { await db`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`; } catch (_) {}

      // Welcome email — best-effort; signup succeeds even if it doesn't send.
      let sentEmail = false;
      if (emailConfigured()) {
        const link = appUrl() + '/onboard';
        const who = childName ? escapeHtml(childName) : 'your child';
        const subject = childName ? `Welcome to My World — let's build ${childName}'s board` : 'Welcome to My World';
        const html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px;">
            <h2 style="color:#ad1457;margin:0 0 12px;font-family:'Fredoka',system-ui;">Welcome to My World 🌍</h2>
            <p>Your account is ready. My World turns ${who}'s real food, toys, people, and home into the vocabulary on their AAC board — rendered in a style they love.</p>
            <p>Pick up where you are anytime by signing in with this email. To build the first board now:</p>
            <p style="margin:22px 0;">
              <a href="${link}" style="display:inline-block;background:#ff1493;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px;">Set up ${who}'s board →</a>
            </p>
            <p style="font-size:12px;color:#6b7280;">If you didn't create this account, you can safely ignore this email.</p>
          </div>`;
        const r = await sendEmail({ to: email, subject, html });
        sentEmail = !!r.ok;
      }

      res.status(200).json({ ok: true, user, slug, sentEmail });
    } catch (err) {
      res.status(500).json({ error: 'Sign-up failed', detail: String(err.message || err) });
    }
    return;
  }

  // Path 2 — invite-gated self-signup. Validate the token first; if it's good,
  // we DO NOT require admin auth (this is how a parent's invitee onboards).
  let invitePayload = null;
  if (inviteToken) {
    const secret = process.env.SESSION_SECRET;
    invitePayload = secret ? await verifySession(inviteToken, secret) : null;
    if (!invitePayload || invitePayload.kind !== 'invite' || !invitePayload.email) {
      res.status(400).json({ error: 'Invalid or expired invite token' }); return;
    }
  }

  let role, email, slug;
  if (invitePayload) {
    role = 'therapist';     // default; we'll upgrade to 'school_team' if the invite said so
    email = String(invitePayload.email || '').trim().toLowerCase();
    slug = null;            // therapist/school_team accounts aren't tied to one child slug
    if (Number.isFinite(Number(invitePayload.requestId))) {
      try {
        const db0 = sql();
        const r0 = await db0`SELECT invite_relation FROM access_requests WHERE id = ${Number(invitePayload.requestId)} LIMIT 1`;
        if (r0.length && r0[0].invite_relation === 'school_team') role = 'school_team';
      } catch (_) { /* fall through with default role */ }
    }
  } else {
    const auth = await checkAuth(req);
    if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
    if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }
    role = ROLES.has(body.role) ? body.role : 'parent';
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    slug = typeof body.slug === 'string' && body.slug ? body.slug.slice(0, 64) : null;
  }
  if (!email) { res.status(400).json({ error: 'Email required' }); return; }

  try {
    const db = sql();
    // Lazily ensure the table exists so the first admin can be created without
    // having run /api/init first.
    await db`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'parent',
        child_slug TEXT,
        reset_token TEXT,
        reset_expires TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      )
    `;
    const hash = hashPassword(password);
    const rows = await db`
      INSERT INTO users (email, password_hash, role, child_slug)
      VALUES (${email}, ${hash}, ${role}, ${slug})
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = CASE WHEN users.role = 'admin' THEN users.role ELSE EXCLUDED.role END,
            child_slug = COALESCE(EXCLUDED.child_slug, users.child_slug)
      RETURNING id, email, role, child_slug
    `;
    const user = rows[0];

    // Self-signup path: drop a session cookie so the very next request from
    // accept-invite.html can call /api/access/respond as the new user.
    if (invitePayload) {
      const secret = process.env.SESSION_SECRET;
      const exp = Date.now() + SESSION_MAX_AGE * 1000;
      const token = await signSession({ uid: Number(user.id), email: user.email, role: user.role, slug: user.child_slug, exp }, secret);
      res.setHeader('Set-Cookie', serializeCookie(token));
      try { await db`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`; } catch (_) {}
    }

    res.status(200).json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Create failed', detail: String(err.message || err) });
  }
}
