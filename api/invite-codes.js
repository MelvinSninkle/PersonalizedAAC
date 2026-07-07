// /api/invite-codes — admin management of private-preview invite codes.
//   GET            list all codes
//   POST {code?,label?}   create a code (a readable one is generated if blank)
//   PUT  ?id= {active}    enable/disable a code
//   DELETE ?id=    remove a code
// Admin-gated. The codes themselves are redeemed (publicly) via /api/invite.
import { randomBytes } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { subscriptionBySku } from './_lib/credits.js';

async function ensureTable(db) {
  await db`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      uses INTEGER NOT NULL DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  // Beta-onboarding perks: an account CREATED after entering this code gets
  // these automatically — a comped tier (sub_override, so features + seed
  // renders work) and a credit grant, so the family never stalls on their
  // first image generation. NULL/0 = plain gate code, no perks.
  await db`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS grant_credits INT NOT NULL DEFAULT 0`;
  await db`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS grant_tier TEXT`;
  await db`ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS grant_tier_days INT`;
}

// No ambiguous characters (no I, L, O, 0, 1) so codes are easy to read aloud.
function randomCode(len = 6) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  let s = '';
  for (const x of bytes) s += alphabet[x % alphabet.length];
  return s;
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }

  const db = sql();
  try { await ensureTable(db); } catch (_) {}

  try {
    if (req.method === 'GET') {
      const codes = await db`SELECT id, code, label, active, uses, last_used_at, created_at,
                                    grant_credits, grant_tier, grant_tier_days
                             FROM invite_codes ORDER BY created_at DESC`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ codes });
      return;
    }

    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      let code = (typeof b.code === 'string' ? b.code.trim() : '') || randomCode();
      code = code.slice(0, 64);
      const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 120) : null;
      // Perks: credits clamp 0..100000; tier must be a real subscription sku
      // (the UI sends starter/plus/pro.monthly); days NULL = comp forever.
      const grantCredits = Math.max(0, Math.min(100000, parseInt(b.grantCredits, 10) || 0));
      const rawTier = String(b.grantTier || '').trim().toLowerCase();
      const grantTier = rawTier && subscriptionBySku(rawTier) ? subscriptionBySku(rawTier).sku : null;
      const grantTierDays = grantTier && Number.isFinite(parseInt(b.grantTierDays, 10)) && parseInt(b.grantTierDays, 10) > 0
        ? parseInt(b.grantTierDays, 10) : null;
      const rows = await db`
        INSERT INTO invite_codes (code, label, grant_credits, grant_tier, grant_tier_days)
        VALUES (${code}, ${label}, ${grantCredits}, ${grantTier}, ${grantTierDays})
        ON CONFLICT (code) DO NOTHING
        RETURNING id, code, label, active, uses, last_used_at, created_at,
                  grant_credits, grant_tier, grant_tier_days`;
      if (!rows.length) { res.status(409).json({ error: 'That code already exists' }); return; }
      res.status(200).json({ ok: true, code: rows[0] });
      return;
    }

    if (req.method === 'PUT') {
      const id = parseInt(req.query.id, 10);
      if (!id) { res.status(400).json({ error: 'id required' }); return; }
      const b = (typeof req.body === 'object' && req.body) || {};
      const active = !!b.active;
      await db`UPDATE invite_codes SET active = ${active} WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!id) { res.status(400).json({ error: 'id required' }); return; }
      await db`DELETE FROM invite_codes WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Invite codes failed', detail: String(err.message || err) });
  }
}
