// Invite-code perks (comped tier + starting credits) for a BRAND-NEW account,
// shared by BOTH signup paths — email/password (api/auth/register.js) and
// Sign-in-with-Apple (api/auth/apple.js). The code arrives either in the
// signed mw_invite cookie (the /welcome web gate) or as an explicit string
// (the native app passes what the user typed, since a native POST carries no
// browser cookie). Creation-time only; best-effort — a perk failure must
// never block the signup itself.
import { verifySession } from '../../lib/session.js';

/// The invite code this request arrived with, if any — read from the signed
/// mw_invite cookie the /welcome gate sets. '' when absent/invalid.
export async function inviteCodeFromCookie(req) {
  try {
    const sec = process.env.SESSION_SECRET;
    const cookies = Object.fromEntries(String((req && req.headers && req.headers.cookie) || '')
      .split(/;\s*/).filter(Boolean)
      .map((p) => { const i = p.indexOf('='); return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]; }));
    const inv = (sec && cookies.mw_invite) ? await verifySession(cookies.mw_invite, sec) : null;
    return inv && inv.inv && typeof inv.code === 'string' ? inv.code.toLowerCase() : '';
  } catch (_) { return ''; }
}

/// Is this a real, ACTIVE invite code? Returns the normalized code, or null.
/// Signup requires this (private preview is enforced at account creation, not
/// just at the page gate) — so it fails CLOSED on a missing table/DB error.
export async function validateInviteCode(db, code) {
  const c = String(code || '').toLowerCase().trim().slice(0, 64);
  if (!c) return null;
  try {
    const rows = await db`SELECT code FROM invite_codes WHERE lower(code) = ${c} AND active = TRUE LIMIT 1`;
    return rows.length ? c : null;
  } catch (_) { return null; }
}

export async function applyInvitePerks(db, userId, req, explicitCode = '') {
  try {
    let invCode = String(explicitCode || '').toLowerCase().trim().slice(0, 64);
    if (!invCode) {
      const sec = process.env.SESSION_SECRET;
      const cookies = Object.fromEntries(String((req && req.headers && req.headers.cookie) || '')
        .split(/;\s*/).filter(Boolean)
        .map((p) => { const i = p.indexOf('='); return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)]; }));
      const inv = (sec && cookies.mw_invite) ? await verifySession(cookies.mw_invite, sec) : null;
      invCode = inv && inv.inv && typeof inv.code === 'string' ? inv.code.toLowerCase() : '';
    }
    if (!invCode) return false;

    // Attribution first — every signup records which code let it in.
    try {
      await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code TEXT`;
      await db`UPDATE users SET invite_code = ${invCode} WHERE id = ${userId}`;
    } catch (_) {}

    const perkRows = await db`
      SELECT grant_credits, grant_tier, grant_tier_days
      FROM invite_codes WHERE lower(code) = ${invCode} AND active = TRUE LIMIT 1`;
    const perk = perkRows[0];
    if (!perk) return false;

    if (Number(perk.grant_credits) > 0) {
      const { ensureCredits, grantCredits } = await import('./credits.js');
      await ensureCredits(db);
      await grantCredits(db, { userId: Number(userId),
        credits: Number(perk.grant_credits), reason: 'invite:' + invCode });
    }
    if (perk.grant_tier) {
      const days = Number(perk.grant_tier_days) > 0 ? Number(perk.grant_tier_days) : null;
      const expiresAt = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
      try {
        await db`UPDATE users SET sub_override = ${perk.grant_tier},
                 sub_override_expires = ${expiresAt} WHERE id = ${userId}`;
      } catch (_) {
        // Pre-expiry-column deploys: comp forever rather than not at all.
        await db`UPDATE users SET sub_override = ${perk.grant_tier} WHERE id = ${userId}`;
      }
    }
    return true;
  } catch (_) { return false; /* perks are additive — never block a signup */ }
}
