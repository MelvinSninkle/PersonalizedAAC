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
import { createHmac, createSign, timingSafeEqual } from 'node:crypto';

// Velocity-guard pause (spendCredits blocked:true) — friendly, support-routed.
const PAUSED_MSG = 'Image making is paused on this account as a safety measure. '
  + "Email support@myworldtaptotalk.com and we'll sort it out right away.";
import { checkAuth } from './_lib/auth.js';
import { canAccessChild } from './_lib/access.js';
import { sql } from './_lib/db.js';
import { isDefaultableTile, loadChildStyleGuideId } from './_lib/onboarding-render.js';
import { archivePriorImage } from './_lib/image-history.js';
import { ensureSeedJobs, ensureCategory, enqueueRenderJob, seedStatus, needsStyling, drainRenderJobs } from './_lib/seed-board.js';
import { ensureCredits, ensureStarter, creditBalance, spendCredits, grantCredits,
         recordPurchase, productCredits, rebuildQuote,
         ensureCoupons, redeemCoupon, randomCouponCode,
         PACKS, SUBSCRIPTION, SUBSCRIPTIONS, subscriptionBySku, entitlementFor,
         requireStyling, NEEDS_SUBSCRIPTION_DETAIL,
         COST, CREDIT_CENTS, bundleQuote } from './_lib/credits.js';
import { voiceCharsThisMonth } from './_lib/voice-usage.js';

// Every styled-render purchase path shares this gate: personalized renders are
// a membership perk (free tier keeps the default board + raw photo adds, and
// keeps everything previously generated forever). Sends the 402 itself and
// returns false when gated.
async function memberOr402(res, db, auth, childId) {
  const gate = await requireStyling(db, { user: auth.user, childId });
  if (!gate.ok) {
    res.status(402).json({ error: 'needs_subscription', tier: gate.ent.tier,
                           detail: NEEDS_SUBSCRIPTION_DETAIL });
    return false;
  }
  return true;
}

// maxDuration 300: after responding, the enqueue flows below drain a few
// render jobs in the background (20-40s each) — same save-first pattern as
// tile-jobs; the cron remains the completion guarantee.
export const config = { api: { bodyParser: false }, maxDuration: 300 };

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
      case 'free-board':     return freeBoard(req, res, db, auth, body);
      case 'personalize-all': return personalizeAll(req, res, db, auth, uid, body);
      case 'personalize-category': return personalizeCategory(req, res, db, auth, uid, body);
      case 'personalize-status': return personalizeStatus(req, res, db, auth, uid);
      case 'impact':         return impact(req, res, db, auth);
      case 'adopt-image':    return adoptImage(req, res, db, auth);
      case 'regen-with':     return regenWith(req, res, db, auth, uid, body);
      case 'retry':          return retryTile(req, res, db, auth, uid, body);
      case 'rebuild':        return rebuild(req, res, db, auth, uid, body);
      case 'iap-verify':     return iapVerify(req, res, db, uid, body);
      case 'play-verify':    return playVerify(req, res, db, uid, body);
      case 'stripe-checkout': return stripeCheckout(req, res, db, auth, uid, body);
      case 'stripe-portal':  return stripePortal(req, res, db, auth, uid);
      case 'sub-override':   return subOverride(req, res, db, auth, uid, body);
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
  // Effective entitlement (honors the admin tier-override simulator) + this
  // month's voice budget so both storefronts can show tier state.
  const ent = await entitlementFor(db, auth.user);
  const voiceUsed = uid ? await voiceCharsThisMonth(db, uid) : 0;
  const voiceCap = ent.features.voiceCharsPerMonth;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    balance: uid ? await creditBalance(db, uid) : 0,
    costs: COST,   // per-spend price facts — clients never hardcode these
    creditCents: CREDIT_CENTS,
    packs: PACKS.map(({ sku, credits, cents, label, appleProductId, googleProductId }) => ({ sku, credits, cents, label, appleProductId, googleProductId })),
    subscription: SUBSCRIPTION,           // legacy field (= Plus)
    subscriptions: SUBSCRIPTIONS,
    entitlement: {
      tier: ent.tier, label: ent.label, source: ent.source,
      features: { stt: ent.features.stt, autoTeach: ent.features.autoTeach,
                  reporting: ent.features.reporting, dataSaving: ent.features.dataSaving },
      voice: { used: voiceUsed, cap: Number.isFinite(voiceCap) ? voiceCap : null },
      creditsPerPeriod: ent.sub ? ent.sub.creditsPerPeriod : 0,
    },
    cost: COST,
    rebuild,
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
  });
}

// Admin tier simulator: set users.sub_override on YOUR OWN account to walk the
// product through every tier ('free' | starter/plus/pro sku | null = real).
// While set, the account behaves exactly like that tier — features gate and
// credits actually drain (chargeForGeneration skips the admin exemption).
async function subOverride(req, res, db, auth, uid, body) {
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }
  // Target: another account by email (the admin COMP control — grants that
  // family the tier's features until cleared), or yourself (the simulator).
  const email = String(body.email || '').trim().toLowerCase();
  let targetId = uid, targetRole = auth.user.role;
  if (email) {
    const t = await db`SELECT id, role FROM users WHERE email = ${email} LIMIT 1`;
    if (!t.length) { res.status(404).json({ error: 'no account with that email', email }); return; }
    targetId = Number(t[0].id);
    targetRole = t[0].role || 'parent';
  }
  if (!targetId) { res.status(400).json({ error: 'no account' }); return; }
  const raw = String(body.tier || '').trim().toLowerCase();
  let value = null;
  if (raw && raw !== 'real' && raw !== 'none') {
    if (raw === 'free') value = 'free';
    else {
      const sub = subscriptionBySku(raw);
      if (!sub) { res.status(400).json({ error: 'unknown tier', tier: raw, valid: ['real', 'free', ...SUBSCRIPTIONS.map((s) => s.sku)] }); return; }
      value = sub.sku;
    }
  }
  // Time-bound comps: days = 7|30|90|… → the override expires by itself;
  // absent/0 = forever (until manually set back to Real).
  const days = Math.max(0, parseInt(body.days, 10) || 0);
  const expires = value && days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
  try {
    await db`UPDATE users SET sub_override = ${value},
             sub_override_expires = ${expires ? expires.toISOString() : null}
             WHERE id = ${targetId}`;
  } catch (_) {
    // Deploys that haven't run /api/init yet lack the expiry column.
    await db`UPDATE users SET sub_override = ${value} WHERE id = ${targetId}`;
  }
  const ent = await entitlementFor(db, { uid: targetId, role: targetRole });
  res.status(200).json({ ok: true, override: value, ...(email ? { email } : {}),
                         expires: expires ? expires.toISOString() : null,
                         tier: ent.tier, label: ent.label, source: ent.source });
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

  await ensureSeedJobs(db);   // styled_style_id columns
  const [rows, items, currentGuide] = await Promise.all([
    shoppableRows(db),
    db`SELECT taxonomy_slug, image_key, free_retry_used, styled_style_id, id FROM items
       WHERE child_id = ${childId} AND taxonomy_slug IS NOT NULL`,
    loadChildStyleGuideId(db, childId),
  ]);
  // Add-on ("store only") boards: never seeded, parents add them from the
  // shop for free — credits only ever buy styling (the credits pricing tier
  // is retired; init.js migrates old rows to 'free').
  let addonBoards = new Set();
  try {
    const bc = await db`SELECT section, label_norm FROM board_catalog WHERE store_only = TRUE`;
    addonBoards = new Set(bc.map((r) => `${r.section}|${r.label_norm}`));
  } catch (_) { /* catalog table may not exist yet */ }
  const mine = new Map(items.map((i) => [i.taxonomy_slug, i]));
  const boardKey = (t) => `${String(t.column_name || '').toLowerCase()}|${String(t.category || '').trim().toLowerCase()}`;
  // An add-on board is invisible to parents until EVERY word has shared
  // default art — a Lab-created board must be fully generated before it
  // can be offered (an art-less free add would land bare word-tiles).
  const incompleteAddons = new Set();
  for (const t of rows) {
    if (addonBoards.has(boardKey(t)) && !t.default_image_key) incompleteAddons.add(boardKey(t));
  }
  const tiles = rows.filter((t) => !incompleteAddons.has(boardKey(t))).map((t) => {
    const it = mine.get(t.id);
    const img = it && it.image_key ? it.image_key : null;
    // "personalized" = styled under the child's CURRENT guide (or before
    // tracking existed) — a style change makes tiles buyable again (§9).
    const personalized = !!(it && !needsStyling(it, currentGuide) && img && !img.startsWith('taxonomy-defaults/'));
    return {
      id: t.id, label: t.label, column: t.column_name,
      category: t.category || null, subcategory: t.subcategory || null,
      previewKey: personalized ? img : (t.default_image_key || null),
      onBoard: !!it, personalized,
      itemId: it ? Number(it.id) : null,
      freeRetryUsed: it ? !!it.free_retry_used : false,
      credits: COST.nano,
      freeBoard: true,                          // credits tier retired — every board free-adds
      storeOnly: addonBoards.has(boardKey(t)),  // optional add-on vs standard library
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
  if (!(await memberOr402(res, db, auth, childId))) return;

  const all = await shoppableRows(db);
  const byId = new Map(all.map((t) => [t.id, t]));
  const rows = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!rows.length) { res.status(400).json({ error: 'no valid words in cart' }); return; }

  // Bundle checkout (a whole category/subcategory at once) earns 20% off —
  // gated to 3+ words so single-word buys can't claim the discount.
  const bundle = body.bundle === true && rows.length >= 3;
  const cost = bundle ? bundleQuote(rows.length) : rows.length * COST.nano;
  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: cost, reason: bundle ? 'store:bundle' : 'store:words', ref: childId });
    if (s.blocked) { res.status(429).json({ error: 'account_paused', detail: PAUSED_MSG }); return; }
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
  drainRenderJobs(db, childId, 3).catch(() => {});
}

// ── Free common-use boards: place/remove a whole category with DEFAULT art ──
//
// Placement with the shared default images is FREE — personalization is what
// costs credits. ON places every shoppable word in (column, category) that is
// missing from the board (no render jobs; /api/sync's read-through fills the
// default art live). OFF removes ONLY non-personalized tiles in that group —
// custom art the family paid for is never deleted.
async function freeBoard(req, res, db, auth, body) {
  const childId = String(body.childId || '').slice(0, 64);
  const column = String(body.column || '').toLowerCase().slice(0, 24);
  const category = String(body.category || '').slice(0, 80);
  const on = body.on !== false;
  if (!childId || !column || !category) { res.status(400).json({ error: 'childId, column, category required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  // Every board free-adds with shared default art — the old credits-priced
  // tier is retired (credits only ever buy styling). init.js migrates any
  // legacy 'credits' catalog rows to 'free'.

  const all = await shoppableRows(db);
  const group = all.filter((t) => String(t.column_name || '').toLowerCase() === column
                                   && String(t.category || '') === category);
  if (!group.length) { res.status(404).json({ error: 'no words in that category' }); return; }
  const slugs = group.map((t) => t.id);

  if (on) {
    await ensureSeedJobs(db);
    const catCache = new Map();
    let placed = 0;
    for (const t of group) {
      const section = String(t.column_name || 'needs').toLowerCase();
      const catId = section === 'needs' ? null
        : await ensureCategory(db, childId, catCache, section, t.category, t.subcategory);
      const ex = await db`SELECT id FROM items WHERE child_id = ${childId} AND taxonomy_slug = ${t.id} LIMIT 1`;
      if (ex.length) continue;
      await db`INSERT INTO items (section, category_id, label, image_key, sound_key, keep_aspect, display_order,
                                  pinned, child_id, taxonomy_slug, needs_review, updated_at)
               VALUES (${section}, ${catId}, ${t.label}, NULL, NULL, FALSE, ${Date.now() + placed}, FALSE,
                       ${childId}, ${t.id}, FALSE, NOW())`;
      placed++;
    }
    res.status(200).json({ ok: true, placed,
      note: placed ? `${placed} words added with the shared pictures — personalize them any time.`
                   : 'Everything in that set is already on the board.' });
    return;
  }

  const gone = await db`DELETE FROM items
    WHERE child_id = ${childId} AND taxonomy_slug = ANY(${slugs})
      AND (image_key IS NULL OR image_key LIKE 'taxonomy-defaults/%')
    RETURNING id`;
  res.status(200).json({ ok: true, removed: gone.length,
    note: `${gone.length} removed. Personalized tiles in this set were kept.` });
}

// ── "Personalize every tile on the board" ───────────────────────────────────
//
// Quote (body.quote=true): how many taxonomy-linked tiles still wear the
// shared default (or no art at all), out of how many total, and the bundle
// price for finishing the set. Buy: spend + force-render every remaining one.
// Personalization is tracked from the board itself: a custom image_key (not
// a taxonomy-defaults/ read-through) IS the record of a personalized tile.
async function personalizeAll(req, res, db, auth, uid, body) {
  const childId = String(body.childId || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  await ensureSeedJobs(db);   // guarantees the styled_style_id columns exist
  const rows = await db`SELECT id, taxonomy_slug, image_key, styled_style_id FROM items
                        WHERE child_id = ${childId} AND taxonomy_slug IS NOT NULL`;
  // Styled-flag dedup (§9): already-styled tiles are skipped and never
  // re-charged — but a STYLE CHANGE makes previously-styled tiles eligible
  // again (the quote the client confirms includes them).
  const currentGuide = await loadChildStyleGuideId(db, childId);
  const remaining = rows.filter((r) => needsStyling(r, currentGuide));
  const total = rows.length;

  // §6: folder chips join the batch — every chip on the child's board still
  // wearing the shared default icon (or none) renders in THEIR style too, so
  // headers/subcategories match the tiles. 1 credit each, same as tiles.
  let chips = [];
  try {
    const cats = await db`
      SELECT c.id, c.section, c.label, p.label AS parent_label
      FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
      WHERE c.child_id = ${childId}
        AND (c.image_key IS NULL OR c.image_key LIKE 'category-defaults/%')`;
    chips = cats.map((c) => ({ section: c.section, label: c.label, parent: c.parent_label || '' }));
  } catch (_) { /* chips are additive — tiles still personalize */ }

  const units = remaining.length + chips.length;
  const cost = units ? bundleQuote(units) : 0;

  if (body.quote === true || !units) {
    res.status(200).json({ ok: true, remaining: remaining.length, chips: chips.length, total, cost });
    return;
  }
  if (!(await memberOr402(res, db, auth, childId))) return;

  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: cost, reason: 'store:personalize_all', ref: childId });
    if (s.blocked) { res.status(429).json({ error: 'account_paused', detail: PAUSED_MSG }); return; }
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: cost, balance: s.balance }); return; }
  }
  await ensureSeedJobs(db);
  for (const r of remaining) await enqueueRenderJob(db, childId, r.taxonomy_slug, { force: true });
  const { enqueueChipJob } = await import('./_lib/seed-board.js');
  for (const ch of chips) {
    try { await enqueueChipJob(db, childId, ch.section, ch.label, ch.parent); } catch (_) {}
  }
  res.status(200).json({ ok: true, charged: isAdmin ? 0 : cost, queued: remaining.length + chips.length,
    balance: uid ? await creditBalance(db, uid) : null,
    note: `${remaining.length} tiles + ${chips.length} folder icons queued — the whole board personalizes over the next while.` });
  drainRenderJobs(db, childId, 3).catch(() => {});
}

// §9: batch "match all images in THIS FOLDER to my child's style".
// { childId, categoryId, quote? } — quote:true returns {remaining,total,cost}
// so the client confirms with the real count/price before any charge.
// Dedup rides the styled flag (needsStyling): already-styled tiles are
// skipped and never re-charged; a style change makes them eligible again.
async function personalizeCategory(req, res, db, auth, uid, body) {
  const childId = String(body.childId || '').slice(0, 64);
  const categoryId = Number(body.categoryId);
  if (!childId || !Number.isFinite(categoryId) || categoryId <= 0) {
    res.status(400).json({ error: 'childId and categoryId required' }); return;
  }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  await ensureSeedJobs(db);
  // Only taxonomy-linked tiles can re-render (they have canonical prompts);
  // photo tiles the family added are theirs as-is.
  const rows = await db`SELECT id, taxonomy_slug, image_key, styled_style_id FROM items
                        WHERE child_id = ${childId} AND category_id = ${categoryId}
                          AND taxonomy_slug IS NOT NULL`;
  const currentGuide = await loadChildStyleGuideId(db, childId);
  const remaining = rows.filter((r) => needsStyling(r, currentGuide));
  const cost = remaining.length ? bundleQuote(remaining.length) : 0;

  if (body.quote === true || !remaining.length) {
    res.status(200).json({ ok: true, remaining: remaining.length, total: rows.length, cost });
    return;
  }
  if (!(await memberOr402(res, db, auth, childId))) return;

  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: cost,
      reason: 'store:personalize_category', ref: childId + ':' + categoryId });
    if (s.blocked) { res.status(429).json({ error: 'account_paused', detail: PAUSED_MSG }); return; }
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: cost, balance: s.balance }); return; }
  }
  for (const r of remaining) await enqueueRenderJob(db, childId, r.taxonomy_slug, { force: true });
  res.status(200).json({ ok: true, charged: isAdmin ? 0 : cost, queued: remaining.length,
    balance: uid ? await creditBalance(db, uid) : null,
    note: `${remaining.length} picture${remaining.length === 1 ? '' : 's'} queued — they land over the next few minutes.` });
  drainRenderJobs(db, childId, 3).catch(() => {});
}

// ── Per-folder personalization status — one call for every "⭐N to finish"
//    badge: how many taxonomy-linked tiles in each board folder still wear
//    the shared default, and the bundle price to finish that folder. ───────
async function personalizeStatus(req, res, db, auth, uid) {
  const childId = String((req.query && req.query.childId) || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  await ensureSeedJobs(db);
  const [rows, cats, currentGuide] = await Promise.all([
    db`SELECT id, category_id, taxonomy_slug, image_key, styled_style_id FROM items
       WHERE child_id = ${childId} AND taxonomy_slug IS NOT NULL`,
    db`SELECT id, section, label FROM categories WHERE child_id = ${childId}`,
    loadChildStyleGuideId(db, childId),
  ]);
  const byCat = new Map();
  for (const r of rows) {
    const k = r.category_id == null ? 0 : Number(r.category_id);
    if (!byCat.has(k)) byCat.set(k, { total: 0, remaining: 0 });
    const g = byCat.get(k);
    g.total++;
    if (needsStyling(r, currentGuide)) g.remaining++;
  }
  const catMeta = new Map(cats.map((c) => [Number(c.id), c]));
  const folders = [...byCat.entries()].map(([cid, g]) => ({
    categoryId: cid || null,
    section: cid ? (catMeta.get(cid)?.section || null) : 'needs',
    label: cid ? (catMeta.get(cid)?.label || '') : 'Needs',
    total: g.total, remaining: g.remaining,
    cost: g.remaining ? bundleQuote(g.remaining) : 0,
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, balance: uid ? await creditBalance(db, uid) : null, costs: COST, folders });
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

// POST ?action=adopt-image { childId, sourceItemId, targetItemId }
// The "Replace" in the add-tile magic: the existing word tile adopts the newly
// generated tile's image (old image archived — never deleted), and the new
// duplicate item row is removed WITHOUT blob cleanup (the target now owns the
// blob; a plain items DELETE would take the image with it).
async function adoptImage(req, res, db, auth) {
  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const childId = String(body.childId || '').slice(0, 64);
  const sourceItemId = Number(body.sourceItemId), targetItemId = Number(body.targetItemId);
  if (!childId || !sourceItemId || !targetItemId || sourceItemId === targetItemId) {
    res.status(400).json({ error: 'childId, sourceItemId, targetItemId required' }); return;
  }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  const [src, tgt] = await Promise.all([
    db`SELECT id, image_key, sound_key FROM items WHERE id = ${sourceItemId} AND child_id = ${childId} LIMIT 1`.then((r) => r[0]),
    db`SELECT id, image_key, sound_key, label, section FROM items WHERE id = ${targetItemId} AND child_id = ${childId} LIMIT 1`.then((r) => r[0]),
  ]);
  if (!src || !src.image_key) { res.status(404).json({ error: 'source tile has no image' }); return; }
  if (!tgt) { res.status(404).json({ error: 'target tile not found' }); return; }

  if (tgt.image_key && !String(tgt.image_key).startsWith('taxonomy-defaults/')) {
    try {
      await archivePriorImage({ db, childId, itemId: tgt.id, oldKey: tgt.image_key,
                                label: tgt.label, section: tgt.section, source: 'adopt-image',
                                who: auth.user.email || null });
    } catch (_) {}
  }
  await db`UPDATE items SET image_key = ${src.image_key},
             sound_key = COALESCE(sound_key, ${src.sound_key}),
             needs_review = FALSE, updated_at = NOW() WHERE id = ${tgt.id}`;
  await db`DELETE FROM items WHERE id = ${src.id}`;   // row only — blobs live on with the target
  res.status(200).json({ ok: true, itemId: Number(tgt.id),
    note: 'Replaced — the old picture is archived in the Album.' });
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
  if (!(await memberOr402(res, db, auth, childId))) return;

  const ref = (await db`SELECT image_key FROM items WHERE id = ${refItemId} AND child_id = ${childId} LIMIT 1`)[0];
  if (!ref || !ref.image_key) { res.status(404).json({ error: 'reference tile has no image yet' }); return; }

  const cost = ids.length * COST.nano;
  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: cost, reason: 'store:regen-with', ref: childId });
    if (s.blocked) { res.status(429).json({ error: 'account_paused', detail: PAUSED_MSG }); return; }
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: cost, balance: s.balance }); return; }
  }
  await ensureSeedJobs(db);
  for (const id of ids) await enqueueRenderJob(db, childId, id, { force: true, refKey: ref.image_key });
  res.status(200).json({
    ok: true, queued: ids.length, charged: isAdmin ? 0 : cost,
    balance: uid ? await creditBalance(db, uid) : null,
    note: `${ids.length} picture${ids.length === 1 ? '' : 's'} re-rendering with your new tile in the scene. Replaced art is archived.`,
  });
  // Best-effort immediate render (the response is already out). Seed jobs are
  // ONLY drained by the minute-cron otherwise — on a deployment where that
  // cron doesn't fire, these paid re-renders sat queued forever.
  drainRenderJobs(db, childId, 3).catch(() => {});
}

// One FREE retry per tile, then 1 credit.
async function retryTile(req, res, db, auth, uid, body) {
  const childId = String(body.childId || '').slice(0, 64);
  const itemId = Number(body.itemId);
  if (!childId || !itemId) { res.status(400).json({ error: 'childId and itemId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  if (!(await memberOr402(res, db, auth, childId))) return;

  const item = (await db`SELECT id, taxonomy_slug, image_key, free_retry_used FROM items
                         WHERE id = ${itemId} AND child_id = ${childId} LIMIT 1`)[0];
  if (!item || !item.taxonomy_slug) { res.status(404).json({ error: 'tile not found (or not a library word)' }); return; }

  const isAdmin = auth.user.role === 'admin';
  let charged = 0;
  if (!item.free_retry_used) {
    await db`UPDATE items SET free_retry_used = TRUE, updated_at = NOW() WHERE id = ${item.id}`;
  } else if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: COST.nano, reason: 'store:retry', ref: String(itemId) });
    if (s.blocked) { res.status(429).json({ error: 'account_paused', detail: PAUSED_MSG }); return; }
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: COST.nano, balance: s.balance }); return; }
    charged = COST.nano;
  }
  // Guided retry: the parent's correction text rides along and the CURRENT
  // image is attached as the previous attempt — the model improves the same
  // picture per the instruction instead of rolling fresh dice. (Old app builds
  // send no guidance and get the legacy blind re-roll.)
  const guidance = String(body.guidance || '').trim().slice(0, 400);
  const priorKey = (guidance && item.image_key && !String(item.image_key).startsWith('taxonomy-defaults/'))
    ? item.image_key : null;
  await ensureSeedJobs(db);
  await enqueueRenderJob(db, childId, item.taxonomy_slug, { force: true, refKey: priorKey, guidance: guidance || null });
  res.status(200).json({ ok: true, charged, freeRetry: charged === 0 && !isAdmin,
                         balance: uid ? await creditBalance(db, uid) : null });
  drainRenderJobs(db, childId, 1).catch(() => {});
}

// Whole-board rebuild at the quoted discount (see rebuildQuote).
async function rebuild(req, res, db, auth, uid, body) {
  const childId = String(body.childId || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }

  if (!(await memberOr402(res, db, auth, childId))) return;

  const words = await db`SELECT DISTINCT taxonomy_slug FROM items
                         WHERE child_id = ${childId} AND taxonomy_slug IS NOT NULL`;
  if (!words.length) { res.status(400).json({ error: 'no library words on this board yet' }); return; }
  const cost = rebuildQuote(words.length);

  const isAdmin = auth.user.role === 'admin';
  if (!isAdmin) {
    const s = await spendCredits(db, { userId: uid, credits: cost, reason: 'store:rebuild', ref: childId });
    if (s.blocked) { res.status(429).json({ error: 'account_paused', detail: PAUSED_MSG }); return; }
    if (!s.ok) { res.status(402).json({ error: 'not_enough_credits', needed: cost, balance: s.balance }); return; }
  }
  await ensureSeedJobs(db);
  for (const w of words) await enqueueRenderJob(db, childId, w.taxonomy_slug, { force: true });

  res.status(200).json({
    ok: true, charged: isAdmin ? 0 : cost, queued: words.length,
    balance: uid ? await creditBalance(db, uid) : null,
    note: `Rebuilding ${words.length} words in your child's style. Every replaced image is archived — you keep them all.`,
  });
  drainRenderJobs(db, childId, 3).catch(() => {});
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

// ── Google Play (Android) ────────────────────────────────────────────────────
// Verifies a purchase token with the Play Developer API using a service
// account (env GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = the key file's JSON;
// PLAY_PACKAGE_NAME defaults to io.andrewpeterson.myworld). Credits are
// granted only after Google confirms — the client consumes/acknowledges only
// after this returns 200, so the server stays the source of truth.

async function playAccessToken() {
  const rawSa = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!rawSa) return null;
  let sa;
  try { sa = JSON.parse(rawSa); } catch (_) { return null; }
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  });
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const jwt = unsigned + '.' + signer.sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt,
    }).toString(),
  });
  const d = await r.json();
  return r.ok ? d.access_token : null;
}

async function playVerify(req, res, db, uid, body) {
  if (!uid) { res.status(400).json({ error: 'no account' }); return; }
  const productId = String(body.productId || '');
  const purchaseToken = String(body.purchaseToken || '');
  if (!productId || !purchaseToken) {
    res.status(400).json({ error: 'productId and purchaseToken required' }); return;
  }
  const grant = productCredits(productId);
  if (!grant) { res.status(400).json({ error: 'unknown product', productId }); return; }

  const token = await playAccessToken();
  if (!token) {
    res.status(501).json({ error: 'play_not_configured',
      detail: 'Set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (+ PLAY_PACKAGE_NAME) to verify Android purchases.' });
    return;
  }
  const pkg = process.env.PLAY_PACKAGE_NAME || 'io.andrewpeterson.myworld';
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}`;

  let verified = false, orderId = null, raw = null;
  if (grant.kind === 'subscription') {
    const r = await fetch(`${base}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
      { headers: { Authorization: 'Bearer ' + token } });
    raw = await r.json();
    const state = String(raw.subscriptionState || '');
    verified = r.ok && (state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD');
    // Renewals keep the token but bump latestOrderId (…-0, …-1, …), so each
    // cycle grants exactly once and client re-posts are idempotent dupes.
    orderId = raw.latestOrderId || null;
  } else {
    const r = await fetch(`${base}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`,
      { headers: { Authorization: 'Bearer ' + token } });
    raw = await r.json();
    verified = r.ok && Number(raw.purchaseState) === 0;   // 0 purchased · 1 canceled · 2 pending
    orderId = raw.orderId || null;
  }
  if (!verified) {
    res.status(400).json({ error: 'not_verified',
      detail: String((raw && (raw.error?.message || raw.subscriptionState || raw.purchaseState)) ?? 'unknown') });
    return;
  }

  const externalId = 'google:' + (orderId || purchaseToken.slice(0, 120));
  // Record the canonical sku for subscriptions so activeSubscription matches.
  const r2 = await recordPurchase(db, {
    userId: uid, platform: 'google', productId: grant.sku || productId,
    credits: grant.credits, amountCents: null, externalId, raw,
  });
  res.status(200).json({
    ok: true, credited: r2.granted ? grant.credits : 0, duplicate: r2.duplicate,
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
  const sub = subscriptionBySku(sku);
  if (!pack && !sub) { res.status(400).json({ error: 'unknown sku', sku }); return; }

  const origin = `https://${req.headers.host}`;
  const form = new URLSearchParams();
  form.set('mode', sub ? 'subscription' : 'payment');
  form.set('success_url', origin + '/store.html?paid=1');
  form.set('cancel_url', origin + '/store.html?canceled=1');
  form.set('client_reference_id', String(uid));
  form.set('metadata[userId]', String(uid));
  form.set('metadata[sku]', sku);
  form.set('line_items[0][quantity]', '1');
  if (sub) {
    form.set('line_items[0][price_data][currency]', 'usd');
    form.set('line_items[0][price_data][unit_amount]', String(sub.cents));
    form.set('line_items[0][price_data][recurring][interval]', 'month');
    form.set('line_items[0][price_data][product_data][name]', `${sub.label} — ${sub.creditsPerPeriod} credits/month`);
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

// "Manage billing" on the web: a Stripe billing-portal session where the
// subscriber can upgrade, downgrade, or cancel. (Apple subscriptions are
// managed in iOS Settings — the app links there instead.)
async function stripePortal(req, res, db, auth, uid) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { res.status(501).json({ error: 'stripe_not_configured' }); return; }
  if (!uid) { res.status(400).json({ error: 'no account' }); return; }
  const row = (await db`SELECT stripe_customer_id FROM users WHERE id = ${uid} LIMIT 1`)[0];
  const customer = row && row.stripe_customer_id;
  if (!customer) {
    res.status(404).json({ error: 'no_stripe_customer',
      detail: 'No web subscription on file for this account. Subscribe here first — or, if you subscribed on the iPad/iPhone, manage it in the App Store settings.' });
    return;
  }
  const origin = `https://${req.headers.host}`;
  const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ customer, return_url: origin + '/store.html' }).toString(),
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
      // Remember the Stripe customer so the billing portal ("Manage billing")
      // can find this account later.
      if (uid && s.customer) {
        try { await db`UPDATE users SET stripe_customer_id = ${String(s.customer)} WHERE id = ${uid}`; } catch (_) {}
      }
    } else if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      const meta = (inv.subscription_details && inv.subscription_details.metadata) || inv.metadata || {};
      let uid = Number(meta.userId) || null;
      // The metadata tag written at checkout is best-effort and async — if it
      // failed or this first invoice raced it, fall back to the Stripe
      // customer id saved at checkout.session.completed. A subscriber must
      // never pay and silently receive nothing.
      if (!uid && inv.customer) {
        try {
          const r = await db`SELECT id FROM users WHERE stripe_customer_id = ${String(inv.customer)} LIMIT 1`;
          uid = r.length ? Number(r[0].id) : null;
        } catch (_) {}
      }
      if (uid) {
        // The tier comes from the subscription's metadata sku (tagged at
        // checkout); older subs without one are the original Plus.
        const sub = subscriptionBySku(meta.sku) || SUBSCRIPTION;
        await recordPurchase(db, { userId: uid, platform: 'stripe', productId: sub.sku,
                                   credits: sub.creditsPerPeriod,
                                   amountCents: inv.amount_paid || null, externalId: 'stripe:' + inv.id });
      } else {
        // Surfaced in Vercel logs — an invoice we could not attribute means a
        // paying subscriber got no credits. Investigate via the Stripe
        // dashboard (customer id below) and grant manually if needed.
        console.error('stripe invoice.paid UNRESOLVED: customer', inv.customer, 'invoice', inv.id);
      }
    } else if (event.type === 'invoice.payment_failed') {
      // Failed renewal: tell the parent (Stripe retries on its own smart
      // schedule, so this is a nudge, not a cutoff). Entitlement is untouched
      // here — activeSubscription's 35-day window is the grace period.
      const inv = event.data.object;
      try {
        const r = await db`SELECT id, email FROM users WHERE stripe_customer_id = ${String(inv.customer || '')} LIMIT 1`;
        const u = r[0];
        const { sendEmail, emailConfigured } = await import('./_lib/email.js');
        if (u && u.email && emailConfigured()) {
          await sendEmail({
            to: u.email,
            subject: "My World — your payment didn't go through",
            text: 'Hi — a membership payment for My World: Tap to Talk did not go through. ' +
                  'Your board keeps working while the card retries automatically. ' +
                  'To update your payment method, open the parent dashboard -> Credits & Store -> Manage billing. ' +
                  'Questions? Just reply, or email support@myworldtaptotalk.com.',
          });
        }
      } catch (_) {}
    } else if (event.type === 'customer.subscription.deleted') {
      // Record the cancellation for visibility (reports / support). Access
      // still lapses via the 35-day activeSubscription window — no abrupt
      // cutoff for the child mid-period.
      const sub = event.data.object;
      try {
        await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_canceled_at TIMESTAMPTZ`;
        await db`UPDATE users SET sub_canceled_at = NOW() WHERE stripe_customer_id = ${String(sub.customer || '')}`;
      } catch (_) {}
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
