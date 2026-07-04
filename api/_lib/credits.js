// The credits wallet — the one currency across web (Stripe) and iOS (StoreKit).
//
// PRICING MODEL (per the product decision):
//   · 1 credit  = one image generated with nano banana (Gemini Flash)
//   · 5 credits = one family-member portrait (keystone quality + its retries)
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
import { randomBytes } from 'node:crypto';

// ── Catalog ──────────────────────────────────────────────────────────────────

export const CREDIT_CENTS = 10;   // list price per credit

export const PACKS = [
  { sku: 'credits50',   credits: 50,   cents: 499,  label: 'Starter', appleProductId: 'credits50'   },
  { sku: 'credits100',  credits: 100,  cents: 999,  label: 'Family',  appleProductId: 'credits100'  },
  { sku: 'credits250',  credits: 250,  cents: 2499, label: 'Super',   appleProductId: 'credits250'  },
  { sku: 'credits500',  credits: 500,  cents: 4999, label: 'Mega',    appleProductId: 'credits500'  },
  { sku: 'credits1000', credits: 1000, cents: 9999, label: 'Ultra',   appleProductId: 'credits1000' },
];

// Retired packs stay redeemable so purchases already in Apple's pipeline
// still credit correctly. Never shown in any storefront.
export const LEGACY_PACKS = [
  { sku: 'credits20',  credits: 20  },
  { sku: 'credits60',  credits: 60  },
  { sku: 'credits150', credits: 150 },
];

// One whole category/subcategory personalized at once: 20% off per-tile.
export function bundleQuote(words) {
  return Math.max(1, Math.ceil(words * 0.8));
}

// ── Membership tiers ─────────────────────────────────────────────────────────
// Three auto-renewing tiers. ALL paid tiers unlock the same features (speech-
// to-text listening mode, auto-teach, reporting, data saving) — they differ in
// monthly image credits and the voice-generation budget (new ElevenLabs
// renders; cached phrases are always free). Pro = Plus + ~$9.99 worth of extra
// credits each month until its exclusive features ship.
// voiceCharsPerMonth counts CHARACTERS of newly synthesized speech (cache
// misses only) — ~25 chars per word/clue, so Starter ≈ 4,000 new phrases/mo.
export const SUBSCRIPTIONS = [
  { sku: 'starter.monthly', cents: 499,  creditsPerPeriod: 10,  label: 'My World Starter',
    appleProductId: 'starter.monthly', voiceCharsPerMonth: 100_000 },
  { sku: 'plus.monthly',    cents: 999,  creditsPerPeriod: 50,  label: 'My World Plus',
    appleProductId: 'plus.monthly',    voiceCharsPerMonth: 300_000 },
  { sku: 'pro.monthly',     cents: 1999, creditsPerPeriod: 150, label: 'My World Pro',
    appleProductId: 'pro.monthly',     voiceCharsPerMonth: 750_000 },
];
// Legacy alias — older call sites treated "the subscription" as Plus.
export const SUBSCRIPTION = SUBSCRIPTIONS[1];

export function subscriptionBySku(sku) {
  return SUBSCRIPTIONS.find((s) => s.sku === sku || s.appleProductId === sku) || null;
}

// What a tier can do. Free = the onboarding portraits (child + parent) plus
// the shared default board; every paid tier turns the platform features on.
export function tierFeatures(sub) {
  const paid = !!sub;
  return {
    stt: paid, autoTeach: paid, reporting: paid, dataSaving: paid,
    voiceCharsPerMonth: sub ? sub.voiceCharsPerMonth : 0,
  };
}

export const COST = { nano: 1, person: 5 };

// Free tier = the two onboarding portraits + the default board. No starter
// wallet anymore (accounts that already received the old 25-credit grant keep
// it — the ledger is append-only and the grant was idempotent by reason).
export const STARTER_CREDITS = 0;

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
  // Admin-only tier simulator: 'free' | a subscription sku | NULL (real state).
  // While set, the account behaves EXACTLY like that tier — including paying
  // credits — so gating and metering can be verified end to end.
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_override TEXT`;
  // Stripe customer id (saved by the checkout webhook) → powers the billing
  // portal so web subscribers can upgrade/downgrade/cancel themselves.
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
}

// ── Wallet ───────────────────────────────────────────────────────────────────

export async function creditBalance(db, userId) {
  const uid = Number(userId);
  const r = await db`SELECT COALESCE(SUM(delta), 0)::int AS bal FROM credit_ledger WHERE user_id = ${uid}`;
  return Number(r[0]?.bal || 0);
}

// Lazily grant the starter wallet exactly once (idempotent via the ledger).
// A no-op while STARTER_CREDITS is 0 (free tier ships no wallet).
export async function ensureStarter(db, userId) {
  if (!(STARTER_CREDITS > 0)) return;
  const uid = Number(userId);
  const has = await db`SELECT 1 FROM credit_ledger WHERE user_id = ${uid} AND reason = 'starter' LIMIT 1`;
  if (!has.length) {
    try {
      await db`INSERT INTO credit_ledger (user_id, delta, reason) VALUES (${uid}, ${STARTER_CREDITS}, 'starter')`;
    } catch (_) {}
  }
}

// ── Entitlements ─────────────────────────────────────────────────────────────

// A subscription is "active" when a periodic grant landed within the last 35
// days — renewals re-grant monthly on both platforms (Stripe invoice.paid;
// StoreKit renewal transactions re-verified by the app), so the window covers
// a full period plus grace.
export async function activeSubscription(db, userId) {
  const uid = Number(userId);
  if (!uid) return null;
  const skus = SUBSCRIPTIONS.flatMap((s) => [s.sku, s.appleProductId]);
  try {
    const r = await db`
      SELECT product_id FROM purchases
      WHERE user_id = ${uid} AND product_id = ANY(${skus})
        AND created_at > NOW() - INTERVAL '35 days'
      ORDER BY created_at DESC LIMIT 1`;
    return r.length ? subscriptionBySku(r[0].product_id) : null;
  } catch (_) { return null; }
}

// The one entitlement resolver. Order:
//   1. users.sub_override (the admin tier simulator) — behaves exactly like
//      that tier, INCLUDING charging credits (charge: true).
//   2. admin role — unlimited, never charged.
//   3. an active subscription purchase.
//   4. free tier.
// Accepts an auth.user-shaped object ({ uid, role }) or a bare user id.
export async function entitlementFor(db, user) {
  const uid = Number(typeof user === 'object' && user ? (user.uid || user.id) : user) || null;
  let role = (typeof user === 'object' && user && user.role) || null;
  let override = null;
  if (uid) {
    try {
      const r = await db`SELECT sub_override, role FROM users WHERE id = ${uid} LIMIT 1`;
      if (r.length) { override = r[0].sub_override || null; if (!role) role = r[0].role; }
    } catch (_) { /* users table variants — fall through */ }
  }
  if (override) {
    const sub = override === 'free' ? null : subscriptionBySku(override);
    return { tier: sub ? sub.sku : 'free', label: sub ? sub.label : 'Free',
             source: 'override', sub, features: tierFeatures(sub), charge: true };
  }
  if (role === 'admin') {
    return { tier: 'admin', label: 'Admin (unlimited)', source: 'admin', sub: null,
             features: { stt: true, autoTeach: true, reporting: true, dataSaving: true,
                         voiceCharsPerMonth: Number.POSITIVE_INFINITY },
             charge: false };
  }
  if (uid) {
    const sub = await activeSubscription(db, uid);
    if (sub) return { tier: sub.sku, label: sub.label, source: 'purchase', sub,
                      features: tierFeatures(sub), charge: true };
  }
  return { tier: 'free', label: 'Free', source: 'none', sub: null,
           features: tierFeatures(null), charge: true };
}

// Styled (in-your-art-style) AI renders are a membership perk on every path —
// photo adds, store words, retries, rebuilds. Raw photo adds and the shared
// default board stay free for everyone. Resolves from the signed-in user when
// known, else the board owner's account.
export async function requireStyling(db, { user = null, childId = null } = {}) {
  let uid = Number(user && (user.uid || user.id)) || null;
  if (!uid && childId) uid = await boardOwnerId(db, childId);
  const ent = await entitlementFor(db, uid ? { uid, role: user && user.role } : user);
  return { ok: !!ent.sub || ent.tier === 'admin', ent };
}

export const NEEDS_SUBSCRIPTION_DETAIL =
  'Making pictures in your child’s own art style is part of My World memberships '
  + '(from $4.99/month). Join in the Store — everything you’ve already made stays yours forever.';

// Resolve the account that owns a child's board (cron jobs and board-device
// requests have no signed-in parent — the entitlement is still the family's).
export async function boardOwnerId(db, childId) {
  if (!childId) return null;
  try {
    const r = await db`SELECT id FROM users WHERE child_slug = ${childId} LIMIT 1`;
    return r.length ? Number(r[0].id) : null;
  } catch (_) { return null; }
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

// Charge helper for the generation endpoints. Admins never pay — UNLESS they
// set a tier override (the simulator must drain credits like a real account).
// Everyone else spends (after the lazy starter grant). Returns { ok, balance,
// exempt }.
export async function chargeForGeneration(db, user, { credits, reason, ref = null }) {
  if (!user) return { ok: true, exempt: true, balance: null };
  const uid = Number(user.uid || user.id);
  if (user.role === 'admin') {
    let override = null;
    if (uid) {
      try {
        const r = await db`SELECT sub_override FROM users WHERE id = ${uid} LIMIT 1`;
        override = (r[0] && r[0].sub_override) || null;
      } catch (_) {}
    }
    if (!override) return { ok: true, exempt: true, balance: null };
  }
  if (!uid) return { ok: true, exempt: true, balance: null };   // legacy token — never hard-block
  await ensureCredits(db);
  await ensureStarter(db, uid);
  return spendCredits(db, { userId: uid, credits, reason, ref });
}

// ── Coupons ──────────────────────────────────────────────────────────────────
// A coupon is a redeemable code worth N credits. Global by nature (anyone with
// the code), scoped by its limits: max_redemptions caps total uses (NULL =
// unlimited — a true global drop), one redemption per user always, optional
// expiry. Admin creates them on the Invites panel next to invite codes.

export async function ensureCoupons(db) {
  await db`
    CREATE TABLE IF NOT EXISTS coupons (
      code TEXT PRIMARY KEY,
      credits INT NOT NULL,
      note TEXT,
      max_redemptions INT,
      redemptions INT NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (code, user_id)
    )`;
}

// Same alphabet as invite codes — no ambiguous characters, easy to read aloud.
export function randomCouponCode(len = 8) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

// Redeem a coupon for a user. Order matters for the races:
//   1. the per-user UNIQUE insert blocks double-redeeming,
//   2. the conditional counter increment blocks over-redeeming a capped code
//      (two users grabbing the last slot → exactly one wins; the loser's
//      redemption row is rolled back),
//   3. only then are the credits granted.
export async function redeemCoupon(db, { userId, code }) {
  const uid = Number(userId);
  const c = String(code || '').trim().toUpperCase();
  if (!uid || !c) return { ok: false, error: 'code required' };

  const coupon = (await db`SELECT code, credits, max_redemptions, redemptions, expires_at, active
                           FROM coupons WHERE code = ${c} LIMIT 1`)[0];
  if (!coupon || !coupon.active) return { ok: false, error: 'That code isn’t valid.' };
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return { ok: false, error: 'That code has expired.' };

  let claimed;
  try {
    claimed = await db`INSERT INTO coupon_redemptions (code, user_id) VALUES (${c}, ${uid}) RETURNING id`;
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/duplicate key|unique/i.test(msg)) return { ok: false, error: 'You’ve already used this code.' };
    throw e;
  }

  const inc = await db`UPDATE coupons SET redemptions = redemptions + 1
                       WHERE code = ${c} AND active = TRUE
                         AND (max_redemptions IS NULL OR redemptions < max_redemptions)
                       RETURNING credits`;
  if (!inc.length) {
    try { await db`DELETE FROM coupon_redemptions WHERE id = ${claimed[0].id}`; } catch (_) {}
    return { ok: false, error: 'That code has been fully used up.' };
  }

  await db`INSERT INTO credit_ledger (user_id, delta, reason, ref)
           VALUES (${uid}, ${coupon.credits}, 'coupon', ${c})`;
  return { ok: true, credits: coupon.credits, balance: await creditBalance(db, uid) };
}

// Map an Apple/Stripe product id back to its credit grant.
export function productCredits(productId) {
  const pack = PACKS.find((p) => p.sku === productId || p.appleProductId === productId)
            || LEGACY_PACKS.find((p) => p.sku === productId);
  if (pack) return { credits: pack.credits, kind: 'pack' };
  const sub = subscriptionBySku(productId);
  if (sub) return { credits: sub.creditsPerPeriod, kind: 'subscription', sku: sub.sku };
  return null;
}
