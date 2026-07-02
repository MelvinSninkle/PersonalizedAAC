// The credits wallet — the one currency across web (Stripe) and iOS (StoreKit).
//
// PRICING MODEL (per the product decision):
//   · 1 credit  = one image generated with nano banana (Gemini Flash)
//   · 3 credits = one family-member portrait (OpenAI keystone quality)
//   · list price 10¢/credit; bundles discount it; the $9.99/mo subscription
//     grants 50 credits each period (packs stack on top)
//   · every image gets ONE free retry (tracked per tile / per person)
//   · whole-board rebuild is quoted dynamically: 70% of the board's word count
//     in credits (30% off à la carte, still a healthy margin over the ~4¢ cost)
//
// LEDGER: credit_ledger is the source of truth (append-only); the balance is
// its SUM. spendCredits() is atomic — a conditional single-statement UPDATE-
// style insert that fails cleanly when the balance is short, so two concurrent
// spends can't double-spend. purchases records every external grant (Stripe
// session / Apple transaction) with a UNIQUE external id, which is what makes
// webhook retries and re-sent receipts idempotent.
//
// Compliance note: iOS sells credits ONLY via StoreKit IAP; the web sells ONLY
// via Stripe. Credits themselves are platform-neutral and spend anywhere.
// ── Catalog ──────────────────────────────────────────────────────────────────

export const CREDIT_CENTS = 10;   // list price per credit

export const PACKS = [
  { sku: 'credits20',  credits: 20,  cents: 199,  label: 'Starter',  appleProductId: 'credits20'  },
  { sku: 'credits60',  credits: 60,  cents: 499,  label: 'Family',   appleProductId: 'credits60'  },
  { sku: 'credits150', credits: 150, cents: 999,  label: 'Super',    appleProductId: 'credits150' },
];

export const SUBSCRIPTION = {
  sku: 'plus.monthly', cents: 999, creditsPerPeriod: 50, label: 'My World Plus',
  appleProductId: 'plus.monthly',
};

export const COST = { nano: 1, person: 3 };

// New parent accounts start with a small wallet so nothing hard-blocks the
// first days (the initial board build is free anyway — actor 'onboarding_seed').
export const STARTER_CREDITS = 25;

// Whole-board rebuild: 30% off à la carte, floor of 50 credits.
export function rebuildQuote(wordCount) {
  return Math.max(50, Math.ceil(wordCount * 0.7));
}

// ── Schema ───────────────────────────────────────────────────────────────────

export async function ensureCredits(db) {
  await db`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      delta INT NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger(user_id, id)`;
  await db`
    CREATE TABLE IF NOT EXISTS purchases (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      platform TEXT NOT NULL,
      product_id TEXT NOT NULL,
      credits INT NOT NULL,
      amount_cents INT,
      external_id TEXT NOT NULL UNIQUE,
      raw JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE INDEX IF NOT EXISTS purchases_user_idx ON purchases(user_id, created_at DESC)`;
  // One free retry per tile; personal portraits track theirs on persons.
  await db`ALTER TABLE items   ADD COLUMN IF NOT EXISTS free_retry_used BOOLEAN NOT NULL DEFAULT FALSE`;
  await db`ALTER TABLE persons ADD COLUMN IF NOT EXISTS free_retry_used BOOLEAN NOT NULL DEFAULT FALSE`;
}

// ── Wallet ───────────────────────────────────────────────────────────────────

export async function creditBalance(db, userId) {
  const uid = Number(userId);
  const r = await db`SELECT COALESCE(SUM(delta), 0)::int AS bal FROM credit_ledger WHERE user_id = ${uid}`;
  return Number(r[0]?.bal || 0);
}

// Lazily grant the starter wallet exactly once (idempotent via the ledger).
export async function ensureStarter(db, userId) {
  const uid = Number(userId);
  const has = await db`SELECT 1 FROM credit_ledger WHERE user_id = ${uid} AND reason = 'starter' LIMIT 1`;
  if (!has.length) {
    try {
      await db`INSERT INTO credit_ledger (user_id, delta, reason) VALUES (${uid}, ${STARTER_CREDITS}, 'starter')`;
    } catch (_) {}
  }
}

export async function grantCredits(db, { userId, credits, reason, ref = null }) {
  const uid = Number(userId);
  await db`INSERT INTO credit_ledger (user_id, delta, reason, ref)
           VALUES (${uid}, ${Math.floor(credits)}, ${reason}, ${ref})`;
  return creditBalance(db, uid);
}

// Atomic spend: the INSERT only lands when the current SUM covers the cost —
// one statement, so concurrent requests can't both pass a stale balance check.
// Returns { ok, balance } — ok:false means insufficient credits (nothing spent).
export async function spendCredits(db, { userId, credits, reason, ref = null }) {
  const uid = Number(userId);
  const cost = Math.max(0, Math.floor(credits));
  if (cost === 0) return { ok: true, balance: await creditBalance(db, uid) };
  const r = await db`
    INSERT INTO credit_ledger (user_id, delta, reason, ref)
    SELECT ${uid}, ${-cost}, ${reason}, ${ref}
    WHERE (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = ${uid}) >= ${cost}
    RETURNING id`;
  const balance = await creditBalance(db, uid);
  return { ok: r.length > 0, balance };
}

// Record an external purchase exactly once and grant its credits. Returns
// false when the external id was already processed (webhook retry, re-sent
// receipt) — the caller should treat that as success.
export async function recordPurchase(db, { userId, platform, productId, credits, amountCents = null, externalId, raw = null }) {
  const uid = Number(userId);
  const ins = await db`
    INSERT INTO purchases (user_id, platform, product_id, credits, amount_cents, external_id, raw)
    VALUES (${uid}, ${platform}, ${productId}, ${credits}, ${amountCents}, ${externalId}, ${raw ? JSON.stringify(raw) : null})
    ON CONFLICT (external_id) DO NOTHING
    RETURNING id`;
  if (!ins.length) return { granted: false, duplicate: true };
  await db`INSERT INTO credit_ledger (user_id, delta, reason, ref)
           VALUES (${uid}, ${credits}, ${'purchase:' + platform}, ${externalId})`;
  return { granted: true, duplicate: false };
}

// Charge helper for the generation endpoints. Admins never pay; everyone else
// spends (after the lazy starter grant). Returns { ok, balance, exempt }.
export async function chargeForGeneration(db, user, { credits, reason, ref = null }) {
  if (!user || user.role === 'admin') return { ok: true, exempt: true, balance: null };
  const uid = Number(user.uid || user.id);
  if (!uid) return { ok: true, exempt: true, balance: null };   // legacy token — never hard-block
  await ensureCredits(db);
  await ensureStarter(db, uid);
  return spendCredits(db, { userId: uid, credits, reason, ref });
}

// Map an Apple/Stripe product id back to its credit grant.
export function productCredits(productId) {
  const pack = PACKS.find((p) => p.sku === productId || p.appleProductId === productId);
  if (pack) return { credits: pack.credits, kind: 'pack' };
  if (productId === SUBSCRIPTION.sku || productId === SUBSCRIPTION.appleProductId) {
    return { credits: SUBSCRIPTION.creditsPerPeriod, kind: 'subscription' };
  }
  return null;
}
