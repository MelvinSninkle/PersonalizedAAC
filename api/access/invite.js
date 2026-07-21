// POST /api/access/invite — parent invites a therapist to a child's team.
// Body: { childId, email, message? }
// Auth: must be a parent of childId (or admin).
//
// Behavior:
//   - Normalize email (lowercase + trim).
//   - Look up user by email. May or may not exist.
//   - Create an access_requests row (direction='invite', status='pending'),
//     with therapist_email always set and therapist_user_id set when known.
//   - Sign an invite token (HMAC over { kind:'invite', requestId, email, exp }).
//   - Send an email via Resend with the accept link.
//   - The pending row is the in-app signal for an already-registered user; they
//     see it in /api/access/pending and on /therapist next time they open it.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { isParentOf } from '../_lib/access.js';
import { sendEmail, emailConfigured, escapeHtml } from '../_lib/email.js';
import { signSession } from '../../lib/session.js';

const INVITE_TTL_SECS = 60 * 60 * 24 * 14;   // links live 14 days

function appUrl() {
  return process.env.APP_URL || process.env.PUBLIC_URL || 'https://aac.andrewpeterson.io';
}
function prettyName(childId) {
  return String(childId || '').replace(/peterson$/i, '').replace(/^\w/, c => c.toUpperCase()) || childId;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const body = (typeof req.body === 'object' && req.body) || {};
  const childId = typeof body.childId === 'string' ? body.childId.trim().slice(0, 64) : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
  const relation = body.relation === 'school_team' ? 'school_team' : 'therapist';
  if (!childId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'childId and a valid email are required' }); return;
  }

  try {
    const db = sql();
    // Permission: parent of this child or admin.
    if (auth.user.role !== 'admin' && !(await isParentOf(auth.user, childId, db))) {
      res.status(403).json({ error: 'Only a parent of this child can invite therapists.' }); return;
    }

    // Reject if the email already has active access to the child.
    const existing = await db`
      SELECT u.id FROM users u
      JOIN child_access ca ON ca.user_id = u.id
      WHERE LOWER(u.email) = ${email} AND ca.child_id = ${childId} AND ca.status = 'active' LIMIT 1`;
    if (existing.length) { res.status(409).json({ error: 'That person already has access to this child.' }); return; }

    // Find an existing pending invite for the same (childId, email); replace it
    // rather than spawning duplicates each time the parent clicks "Invite".
    const targetUser = (await db`SELECT id FROM users WHERE LOWER(email) = ${email} LIMIT 1`)[0] || null;
    await db`
      UPDATE access_requests SET status = 'declined', decided_at = NOW()
      WHERE child_id = ${childId} AND LOWER(therapist_email) = ${email} AND status = 'pending'`;

    const rows = await db`
      INSERT INTO access_requests (child_id, therapist_user_id, therapist_email, direction, status, created_by, invite_relation)
      VALUES (${childId}, ${targetUser ? targetUser.id : null}, ${email}, 'invite', 'pending', ${auth.user.id || null}, ${relation})
      RETURNING id, created_at`;
    const requestId = Number(rows[0].id);

    const secret = process.env.SESSION_SECRET;
    if (!secret) { res.status(500).json({ error: 'SESSION_SECRET not configured' }); return; }
    const exp = Date.now() + INVITE_TTL_SECS * 1000;
    const token = await signSession({ kind: 'invite', requestId, email, childId, exp }, secret);
    const link = appUrl() + '/accept-invite?t=' + encodeURIComponent(token);

    // Send the email (best-effort — the in-app pending row is the source of truth).
    let emailResult = { ok: false, error: 'email not configured' };
    if (emailConfigured()) {
      const childName = prettyName(childId);
      const inviterName = (auth.user.email || 'A parent').split('@')[0];
      const userExists = !!targetUser;
      const subject = `You're invited to join ${childName}'s therapy team on My World`;
      const html = `
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;max-width:560px;margin:0 auto;padding:24px;">
          <h2 style="color:#ad1457;margin:0 0 12px;font-family:'Fredoka',system-ui;">You're invited to ${escapeHtml(childName)}'s therapy team</h2>
          <p>${escapeHtml(inviterName)} has invited you to join ${escapeHtml(childName)}'s team on <strong>My World</strong>, an AAC app for non-verbal children. As a team member you can run live games on ${escapeHtml(childName)}'s tablet, see progress, and build your own custom boards for them.</p>
          ${message ? `<blockquote style="border-left:3px solid #fce4ec;padding:8px 14px;margin:14px 0;color:#374151;background:#fff7fb;border-radius:6px;">${escapeHtml(message)}</blockquote>` : ''}
          <p style="margin:22px 0;">
            <a href="${link}" style="display:inline-block;background:#ff1493;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:999px;">${userExists ? 'Sign in to accept' : 'Create your account & accept'}</a>
          </p>
          <p style="font-size:12px;color:#6b7280;">This invitation expires in 14 days. If you don't recognize this invitation, you can safely ignore this email. No account is created until you accept.</p>
        </div>`;
      emailResult = await sendEmail({ to: email, subject, html });
    }

    res.status(200).json({
      ok: true,
      requestId,
      sentEmail: emailResult.ok,
      emailError: emailResult.ok ? null : emailResult.error,
      hasAccount: !!targetUser,
    });
  } catch (err) {
    res.status(500).json({ error: 'Invite failed', detail: String(err.message || err) });
  }
}
