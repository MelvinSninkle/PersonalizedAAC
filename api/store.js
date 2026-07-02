// /api/store — the parent store: credits wallet, word shop, and payments.
//
//   GET  ?action=catalog&childId=   packs + subscription + rebuild quote + balance
//   GET  ?action=browse&childId=    the shoppable word library, grouped, with
//                                   default-image previews + owned/personalized flags
//   GET  ?action=history            recent ledger + purchases (receipts view)
//   POST ?action=checkout           { childId, taxonomyIds:[] } spend credits →
//                                   place words + queue personalized renders
//   POST ?action=retry              { childId, itemId } one FREE retry per tile,
//                                   then 1 credit — re-renders in the child's style
//   POST ?action=rebuild            { childId } whole-board rebuild at the quote
//   POST ?action=iap-verify         { jws | productId+transactionId } StoreKit 2
//                                   grant (iOS purchases — Apple-compliant path)
//   POST ?action=stripe-checkout    { sku } → Stripe Checkout session URL (web)
//   POST ?action=stripe-webhook     Stripe events (signature-verified, idempotent)
//   POST ?action=grant              admin: { email, credits, note }
//
// COMPLIANCE: the iOS app buys credits/subscriptions ONLY through StoreKit IAP
// (verified here via iap-verify); the web buys ONLY through Stripe. Credits are
// one wallet spendable on either surface. Spending credits on renders is not a
// purchase and needs no IAP.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { canAccessChild } from './_lib/access.js';
import { sql } from './_lib/db.js';
import { isDefaultableTile } from './_lib/onboarding-render.js';
import { ensureSeedJobs, ensureCategory, enqueueRenderJob, seedStatus } from './_lib/seed-board.js';
import { ensureCredits, ensureStarter, creditBalance, spendCredits, grantCredits,
         recordPurchase, productCredits, rebuildQuote,
         ensureCoupons, redeemCoupon, randomCouponCode,
         PACKS, SUBSCRIPTION, COST, CREDIT_CENTS } from './_lib/credits.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}
function parseJSON(buf) { try { return JSON.parse(buf.toString('utf8') || '{}'); } catch (_) { return {}; } }

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '');
  const db = sql();
  const raw = req.method === 'POST' ? await readRawBody(req) : null;

  // Stripe webhook authenticates by signature, not session — handle first.
  if (action === 'stripe-webhook') return stripeWebhook(req, res, db, raw);

  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const uid = Number(auth.user.uid || auth.user.id) || null;
  const body = raw ? parseJSON(raw) : {};

  try {
    await ensureCredits(db);
    if (uid) await ensureStarter(db, uid);

    switch (action) {
      case 'catalog':        return catalog(req, res, db, auth, uid);
      case 'browse':         return browse(req, res, db, auth);
      case 'history':        return history(req, res, db, uid);
      case 'checkout':       return checkout(req, res, db, auth, uid, body);
      case 'impact':         return impact(req, res, db, auth);
      case 'regen-with':     return regenWith(req, res, db, auth, uid, body);
      case 'retry':          return retryTile(req, res, db, auth, uid, body);
      case 'rebuild':        return rebuild(req, res, db, auth, uid, body);
      case 'iap-verify':     return iapVerify(req, res, db, uid, body);
      case 'stripe-checkout': return stripeCheckout(req, res, db, auth, uid, body);
      case 'redeem':         return redeem(req, res, db, uid, body);
      case 'grant':          return adminGrant(req, res, db, auth, body);
      case 'grant-all':      return adminGrantAll(req, res, db, auth, body);
      case 'coupons':        return adminCoupons(req, res, db, auth);
      case 'coupon-create':  return adminCouponCreate(req, res, db, auth, body);
      case 'coupon-update':  return adminCouponUpdate(req, res, db, auth, body);
      default:
        res.status(404).json({ error: 'unknown store action', action });
    }
  } catch (err) {
    res.status(500).json({ error: 'store failed', action, detail: String(err.message || err) });
  }
}

// ── Catalog / balance ────────────────────────────────────────────────────────

async function catalog(req, res, db, auth, uid) {
  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  let rebuild = null;
  if (childId && await canAccessChild(auth.user, childId, db)) {
    const n = Number((await db`SELECT COUNT(*)::int AS c FROM items
                               WHERE child_id = ${childId} AND taxonomy_slug IS NOT NULL`)[0]?.c || 0);
    if (n > 0) rebuild = { words: n, credits: rebuildQuote(n), listCredits: n };
    // Surface live build progress so the store can show "still rendering".
    try { await ensureSeedJobs(db); rebuild = { ...rebuild, status: await seedStatus(db, childId) }; } catch (_) {}
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    balance: uid ? await creditBalance(db, uid) : 0,
    creditCents: CREDIT_CENTS,
    packs: PACKS.map(({ sku, credits, cents, label, appleProductId }) => ({ sku, credits, cents, label, appleProductId })),
    subscription: SUBSCRIPTION,
    cost: COST,
    rebuild,
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
  });
}

async function history(req, res, db, uid) {
  if (!uid) { res.status(400).json({ error: 'no account' }); return; }
  const ledger = await db`SELECT delta, reason, ref, created_at FROM credit_ledger
                          WHERE user_id = ${uid} ORDER BY id DESC LIMIT 50`;
  const bought = await db`SELECT platform, product_id, credits, amount_cents, created_at FROM purchases
                          WHERE user_id = ${uid} ORDER BY id DESC LIMIT 20`;
  res.status(200).json({ ok: true, balance: await creditBalance(db, uid), ledger, purchases: bought });
}

// ── The word shop ────────────────────────────────────────────────────────────

// Shoppable = the canonical, universal, non-person library (family portraits are
// added through the family flow at the 3-credit tier, not here).
async function shoppableRows(db) {
  const rows = await db`
    SELECT id, column_name, category, subcategory, label, prompt_template, subject_mode, default_image_key
    FROM taxonomy
    WHERE COALESCE(archived, FALSE) = FALSE
      AND COALESCE(is_event, FALSE) = FALSE
      AND COALESCE(is_gestalt, FALSE) = FALSE
      AND COALESCE(authoring_kind, 'canonical') = 'canonical'
      AND COALESCE(audience, 'universal') = 'universal'
    ORDER BY column_name, category NULLS LAST, subcategory NULLS LAST, label, id`;
  return rows.filter((t) => isDefaultableTile(t) || t.subject_mode === 'child_as_subject');
}

async function browse(req, res, db, auth) {
  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  const [rows, items] = await Promise.all([
    shoppableRows(db),
    db`SELECT taxonomy_slug, image_key, free_retry_used, id FROM items
       WHERE child_id = ${childId} AND taxonomy_slug IS NOT NULL`,
  ]);
  const mine = new Map(items.map((i) => [i.taxonomy_slug, i]));
  const tiles = rows.map((t) => {
    const it = mine.get(t.id);
    const img = it && it.image_key ? it.image_key : null;
    const personalized = !!(img && !img.startsWith('taxonomy-defaults/'));
    return {
      id: t.id, label: t.label, column: t.column_name,
      category: t.category || null, subcategory: t.subcategory || null,
      previewKey: personalized ? img : (t.default_image_key || null),
      onBoard: !!it, personalized,
      itemId: it ? Number(it.id) : null,
      freeRetryUsed: it ? !!it.free_retry_used : false,
      credits: COST.nano,
    };
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, tiles, cost: COST });
}

// Checkout: each word = 1 credit → the word is placed on the board (if missing)
// and a personalized render is queued in the child's style. The family keeps
// every image ever made — replaced art is archived, never deleted.
async function checkout(req, res, db, auth, uid, body) {
  const childId = String(body.childId || '').slice(0, 64);
  const ids = Array.isArray(body.taxonomyIds) ? body.taxonomyIds.map(String).slice(0, 500) : [];
  if (!childId || !ids.length) { res.status(400).json({ error: 'childId and taxonomyIds required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  if (!uid) { res.status(400).json({ error: 'no account' }); return; }

  const all = await shoppableRows(db);
  const byId = new Map(all.map((t) => [t.id, t]));
  const rows = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!rows.length) { res.status(400).json({ error: 'no valid words in cart' }); return; }

  const cost = rows.length * COST.nano;
  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: cost, reason: 'store:words', ref: childId });
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: cost, balance: s.balance }); return; }
  }

  await ensureSeedJobs(db);
  const catCache = new Map();
  let queued = 0;
  for (const t of rows) {
    const section = String(t.column_name || 'needs').toLowerCase();
    const catId = section === 'needs' ? null
      : await ensureCategory(db, childId, catCache, section, t.category, t.subcategory);
    const ex = await db`SELECT id FROM items WHERE child_id = ${childId} AND taxonomy_slug = ${t.id} LIMIT 1`;
    if (!ex.length) {
      await db`INSERT INTO items (section, category_id, label, image_key, sound_key, keep_aspect, display_order,
                                  pinned, child_id, taxonomy_slug, needs_review, updated_at)
               VALUES (${section}, ${catId}, ${t.label}, NULL, NULL, FALSE, ${Date.now() + queued}, FALSE,
                       ${childId}, ${t.id}, FALSE, NOW())`;
    }
    // Paid render: force so it upgrades a shared default to the child's style.
    await enqueueRenderJob(db, childId, t.id, { force: true });
    queued++;
  }

  res.status(200).json({
    ok: true, charged: isAdmin ? 0 : cost, queued,
    balance: uid ? await creditBalance(db, uid) : null,
    note: `${queued} word${queued === 1 ? '' : 's'} queued — they render in your child's style over the next few minutes.`,
  });
}

// ── Contextual magic: "your new fork appears in these pictures" ─────────────

// GET ?action=impact&childId=&word=  →
//   { existing: {itemId,label,imageKey,isDefault} | null,   // exact-word tile on the board
//     affected: [{taxonomyId,itemId,label,previewKey}] }    // OTHER board tiles whose prompt
//                                                           // mentions the word (objects_present)
// Matching runs against the curated objects_present index — never raw prompt
// text — so filler words ("a", "the") are structurally unmatchable.
async function impact(req, res, db, auth) {
  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  const raw = String((req.query && req.query.word) || '').trim().toLowerCase();
  if (!childId || !raw) { res.status(400).json({ error: 'childId and word required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  // Simple singular/plural variants so "forks" finds "fork" prompts.
  const variants = [...new Set([raw, raw + 's', raw.endsWith('s') ? raw.slice(0, -1) : raw])].filter(Boolean);

  const [exact, mentions] = await Promise.all([
    db`SELECT id, label, image_key FROM items
       WHERE child_id = ${childId} AND lower(label) = ${raw} LIMIT 2`,
    db`SELECT t.id AS tax_id, i.id AS item_id, i.label, i.image_key, t.default_image_key
       FROM taxonomy t
       JOIN items i ON i.taxonomy_slug = t.id AND i.child_id = ${childId}
       WHERE t.objects_present && ${variants}
         AND lower(t.label) != ${raw}
       ORDER BY i.label LIMIT 100`,
  ]);
  const ex = exact[0] || null;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    existing: ex ? {
      itemId: Number(ex.id), label: ex.label, imageKey: ex.image_key,
      isDefault: !ex.image_key || String(ex.image_key).startsWith('taxonomy-defaults/'),
    } : null,
    affected: mentions.map((m) => ({
      taxonomyId: m.tax_id, itemId: Number(m.item_id), label: m.label,
      previewKey: m.image_key || m.default_image_key || null,
    })),
  });
}

// POST ?action=regen-with { childId, taxonomyIds:[], refItemId }
// Re-render the chosen pictures WITH the new tile's image attached as a
// reference ("include this exact fork"). 1 credit each; replaced art archives.
async function regenWith(req, res, db, auth, uid, body) {
  const childId = String(body.childId || '').slice(0, 64);
  const ids = Array.isArray(body.taxonomyIds) ? body.taxonomyIds.map(String).slice(0, 100) : [];
  const refItemId = Number(body.refItemId);
  if (!childId || !ids.length || !refItemId) { res.status(400).json({ error: 'childId, taxonomyIds, refItemId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  const ref = (await db`SELECT image_key FROM items WHERE id = ${refItemId} AND child_id = ${childId} LIMIT 1`)[0];
  if (!ref || !ref.image_key) { res.status(404).json({ error: 'reference tile has no image yet' }); return; }

  const cost = ids.length * COST.nano;
  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: cost, reason: 'store:regen-with', ref: childId });
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: cost, balance: s.balance }); return; }
  }
  await ensureSeedJobs(db);
  for (const id of ids) await enqueueRenderJob(db, childId, id, { force: true, refKey: ref.image_key });
  res.status(200).json({
    ok: true, queued: ids.length, charged: isAdmin ? 0 : cost,
    balance: uid ? await creditBalance(db, uid) : null,
    note: `${ids.length} picture${ids.length === 1 ? '' : 's'} re-rendering with your new tile in the scene. Replaced art is archived.`,
  });
}

// One FREE retry per tile, then 1 credit.
async function retryTile(req, res, db, auth, uid, body) {
  const childId = String(body.childId || '').slice(0, 64);
  const itemId = Number(body.itemId);
  if (!childId || !itemId) { res.status(400).json({ error: 'childId and itemId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  const item = (await db`SELECT id, taxonomy_slug, free_retry_used FROM items
                         WHERE id = ${itemId} AND child_id = ${childId} LIMIT 1`)[0];
  if (!item || !item.taxonomy_slug) { res.status(404).json({ error: 'tile not found (or not a library word)' }); return; }

  const isAdmin = auth.user.role === 'admin';
  let charged = 0;
  if (!item.free_retry_used) {
    await db`UPDATE items SET free_retry_used = TRUE, updated_at = NOW() WHERE id = ${item.id}`;
  } else if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: COST.nano, reason: 'store:retry', ref: String(itemId) });
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: COST.nano, balance: s.balance }); return; }
    charged = COST.nano;
  }
  await ensureSeedJobs(db);
  await enqueueRenderJob(db, childId, item.taxonomy_slug, { force: true });
  res.status(200).json({ ok: true, charged, freeRetry: charged === 0 && !isAdmin,
                         balance: uid ? await creditBalance(db, uid) : null });
}

// Whole-board rebuild at the quoted discount (see rebuildQuote).
async function rebuild(req, res, db, auth, uid, body) {
  const childId = String(body.childId || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  const words = await db`SELECT DISTINCT taxonomy_slug FROM items
                         WHERE child_id = ${childId} AND taxonomy_slug IS NOT NULL`;
  if (!words.length) { res.status(400).json({ error: 'no library words on this board yet' }); return; }
  const cost = rebuildQuote(words.length);

  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: cost, reason: 'store:rebuild', ref: childId });
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: cost, balance: s.balance }); return; }
  }
  await ensureSeedJobs(db);
  for (const w of words) await enqueueRenderJob(db, childId, w.taxonomy_slug, { force: true });

  res.status(200).json({
    ok: true, charged: isAdmin ? 0 : cost, queued: words.length,
    balance: uid ? await creditBalance(db, uid) : null,
    note: `Rebuilding ${words.length} words in your child's style. Every replaced image is archived — you keep them all.`,
  });
}

// ── Apple IAP (StoreKit 2) ───────────────────────────────────────────────────

// The app performs StoreKit 2 on-device verification, then posts the signed
// transaction (JWS). We decode the payload and grant idempotently by Apple's
// transactionId (each renewal has a fresh id, so subscriptions re-grant each
// period). NOTE: full x5c chain verification against Apple's roots (or the App
// Store Server API) should be added before launch-scale; the session auth +
// idempotency keep this safe for the private preview.
function decodeJWSPayload(jws) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch (_) { return null; }
}

async function iapVerify(req, res, db, uid, body) {
  if (!uid) { res.status(400).json({ error: 'no account' }); return; }
  const payload = body.jws ? decodeJWSPayload(body.jws) : body;
  const productId = String((payload && (payload.productId || payload.product_id)) || '');
  const transactionId = String((payload && (payload.transactionId || payload.transaction_id)) || '');
  if (!productId || !transactionId) { res.status(400).json({ error: 'productId and transactionId required (or a jws)' }); return; }

  const grant = productCredits(productId);
  if (!grant) { res.status(400).json({ error: 'unknown product', productId }); return; }

  const r = await recordPurchase(db, {
    userId: uid, platform: 'apple', productId,
    credits: grant.credits, amountCents: null,
    externalId: 'apple:' + transactionId,
    raw: payload && payload.jws ? null : payload,
  });
  res.status(200).json({
    ok: true, credited: r.granted ? grant.credits : 0, duplicate: r.duplicate,
    kind: grant.kind, balance: await creditBalance(db, uid),
  });
}

// ── Stripe (web) ─────────────────────────────────────────────────────────────

async function stripeCheckout(req, res, db, auth, uid, body) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { res.status(501).json({ error: 'stripe_not_configured', detail: 'Set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET) to sell on the web. iOS uses in-app purchase.' }); return; }
  if (!uid) { res.status(400).json({ error: 'no account' }); return; }
  const sku = String(body.sku || '');
  const pack = PACKS.find((p) => p.sku === sku);
  const isSub = sku === SUBSCRIPTION.sku;
  if (!pack && !isSub) { res.status(400).json({ error: 'unknown sku', sku }); return; }

  const origin = `https://${req.headers.host}`;
  const form = new URLSearchParams();
  form.set('mode', isSub ? 'subscription' : 'payment');
  form.set('success_url', origin + '/store.html?paid=1');
  form.set('cancel_url', origin + '/store.html?canceled=1');
  form.set('client_reference_id', String(uid));
  form.set('metadata[userId]', String(uid));
  form.set('metadata[sku]', sku);
  form.set('line_items[0][quantity]', '1');
  if (isSub) {
    form.set('line_items[0][price_data][currency]', 'usd');
    form.set('line_items[0][price_data][unit_amount]', String(SUBSCRIPTION.cents));
    form.set('line_items[0][price_data][recurring][interval]', 'month');
    form.set('line_items[0][price_data][product_data][name]', `${SUBSCRIPTION.label} — ${SUBSCRIPTION.creditsPerPeriod} credits/month`);
  } else {
    form.set('line_items[0][price_data][currency]', 'usd');
    form.set('line_items[0][price_data][unit_amount]', String(pack.cents));
    form.set('line_items[0][price_data][product_data][name]', `${pack.label} pack — ${pack.credits} image credits`);
  }
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const d = await r.json();
  if (!r.ok) { res.status(502).json({ error: 'stripe error', detail: d.error && d.error.message }); return; }
  res.status(200).json({ ok: true, url: d.url });
}

function verifyStripeSignature(raw, header, secret) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expect = createHmac('sha256', secret).update(`${parts.t}.${raw.toString('utf8')}`).digest('hex');
  try { return timingSafeEqual(Buffer.from(expect), Buffer.from(parts.v1)); } catch (_) { return false; }
}

async function stripeWebhook(req, res, db, raw) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) { res.status(501).json({ error: 'stripe webhook not configured' }); return; }
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
    res.status(400).json({ error: 'bad signature' }); return;
  }
  const event = parseJSON(raw);
  await ensureCredits(db);
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const uid = Number(s.metadata && s.metadata.userId) || Number(s.client_reference_id) || null;
      const sku = (s.metadata && s.metadata.sku) || '';
      const grant = productCredits(sku);
      // One-time packs grant here; the subscription's periodic grants come from
      // invoice.paid (which also fires for the first period).
      if (uid && grant && s.mode === 'payment') {
        await recordPurchase(db, { userId: uid, platform: 'stripe', productId: sku, credits: grant.credits,
                                   amountCents: s.amount_total || null, externalId: 'stripe:' + s.id });
      }
      if (uid && s.mode === 'subscription' && s.subscription) {
        // Tag the subscription so invoice.paid events can find the user.
        try {
          await fetch(`https://api.stripe.com/v1/subscriptions/${s.subscription}`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ 'metadata[userId]': String(uid), 'metadata[sku]': sku }).toString(),
          });
        } catch (_) {}
      }
    } else if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      const meta = (inv.subscription_details && inv.subscription_details.metadata) || inv.metadata || {};
      const uid = Number(meta.userId) || null;
      if (uid) {
        await recordPurchase(db, { userId: uid, platform: 'stripe', productId: SUBSCRIPTION.sku,
                                   credits: SUBSCRIPTION.creditsPerPeriod,
                                   amountCents: inv.amount_paid || null, externalId: 'stripe:' + inv.id });
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    res.status(500).json({ error: 'webhook processing failed', detail: String(err.message || err) });
  }
}

// ── Coupons (parent redeem + admin manage) ───────────────────────────────────

async function redeem(req, res, db, uid, body) {
  if (!uid) { res.status(400).json({ error: 'no account' }); return; }
  await ensureCoupons(db);
  const r = await redeemCoupon(db, { userId: uid, code: body.code });
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  res.status(200).json({ ok: true, credited: r.credits, balance: r.balance });
}

async function adminCoupons(req, res, db, auth) {
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  await ensureCoupons(db);
  const rows = await db`SELECT code, credits, note, max_redemptions, redemptions, expires_at, active, created_at
                        FROM coupons ORDER BY created_at DESC LIMIT 200`;
  res.status(200).json({ ok: true, coupons: rows });
}

async function adminCouponCreate(req, res, db, auth, body) {
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  await ensureCoupons(db);
  const credits = Math.floor(Number(body.credits) || 0);
  if (credits <= 0) { res.status(400).json({ error: 'credits must be a positive number' }); return; }
  const code = (String(body.code || '').trim().toUpperCase() || randomCouponCode()).slice(0, 40);
  const maxRedemptions = Number(body.maxRedemptions) > 0 ? Math.floor(Number(body.maxRedemptions)) : null;
  const expiresDays = Number(body.expiresDays) > 0 ? Math.floor(Number(body.expiresDays)) : null;
  const note = String(body.note || '').slice(0, 200) || null;
  try {
    const rows = await db`
      INSERT INTO coupons (code, credits, note, max_redemptions, expires_at, created_by)
      VALUES (${code}, ${credits}, ${note}, ${maxRedemptions},
              ${expiresDays ? new Date(Date.now() + expiresDays * 86400000) : null},
              ${auth.user.email || 'admin'})
      RETURNING code, credits, max_redemptions, expires_at`;
    res.status(200).json({ ok: true, coupon: rows[0] });
  } catch (e) {
    if (/duplicate key|unique/i.test(String(e.message || e))) { res.status(409).json({ error: 'That code already exists.' }); return; }
    throw e;
  }
}

async function adminCouponUpdate(req, res, db, auth, body) {
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  await ensureCoupons(db);
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) { res.status(400).json({ error: 'code required' }); return; }
  const rows = await db`UPDATE coupons SET active = ${!!body.active} WHERE code = ${code} RETURNING code, active`;
  if (!rows.length) { res.status(404).json({ error: 'coupon not found' }); return; }
  res.status(200).json({ ok: true, coupon: rows[0] });
}

// ── Admin grants ─────────────────────────────────────────────────────────────

async function adminGrant(req, res, db, auth, body) {
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  const email = String(body.email || '').trim().toLowerCase();
  const credits = Math.floor(Number(body.credits) || 0);
  if (!email || !credits) { res.status(400).json({ error: 'email and credits required' }); return; }
  const u = (await db`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`)[0];
  if (!u) { res.status(404).json({ error: 'user not found', email }); return; }
  const bal = await grantCredits(db, { userId: u.id, credits, reason: 'admin:grant', ref: body.note || null });
  res.status(200).json({ ok: true, email, credited: credits, balance: bal });
}

// Global drop: every account (admins excluded) gets the credits in one ledger
// sweep. `ref` carries the note so the receipt view can show why.
async function adminGrantAll(req, res, db, auth, body) {
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
  const credits = Math.floor(Number(body.credits) || 0);
  if (credits <= 0) { res.status(400).json({ error: 'credits must be a positive number' }); return; }
  const note = String(body.note || '').slice(0, 200) || null;
  const rows = await db`
    INSERT INTO credit_ledger (user_id, delta, reason, ref)
    SELECT id, ${credits}, 'admin:grant-all', ${note} FROM users WHERE role != 'admin'
    RETURNING id`;
  res.status(200).json({ ok: true, credited: credits, users: rows.length });
}
