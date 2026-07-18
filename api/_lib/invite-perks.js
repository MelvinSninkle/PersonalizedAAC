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

/// Is this a real, ACTIVE invite code with signup room left? Returns
/// { code } when usable, { code, full: true } when the code exists but its
/// signup limit is spent (so the caller can say WHY and point at the
/// waitlist), or null when unknown/inactive. Signup requires this (private
/// preview is enforced at account creation, not just at the page gate) — so
/// it fails CLOSED on a missing table/DB error.
///
/// The limit counts ACCOUNTS CREATED with the code (users.invite_code
/// attribution), not gate unlocks — a family re-entering the code on a
/// second device never burns a slot. Count-then-insert has a small race
/// under simultaneous signups; a cap of 1000 landing at 1002 is fine, this
/// is a cash-flow throttle, not a ledger.
export async function validateInviteCode(db, code) {
  const c = String(code || '').toLowerCase().trim().slice(0, 64);
  if (!c) return null;
  try {
    await db`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS max_uses INTEGER`;
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code TEXT`;
    const rows = await db`
      SELECT ic.code, ic.max_uses,
             (SELECT COUNT(*)::int FROM users u WHERE lower(u.invite_code) = lower(ic.code)) AS signups
      FROM invite_codes ic
      WHERE lower(ic.code) = ${c} AND ic.active = TRUE LIMIT 1`;
    if (!rows.length) return null;
    const r = rows[0];
    if (r.max_uses != null && Number(r.signups) >= Number(r.max_uses)) return { code: c, full: true };
    return { code: c };
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
