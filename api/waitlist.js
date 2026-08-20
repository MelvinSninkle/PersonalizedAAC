// /api/waitlist — the landing-page waitlist, now the front door of the
// Founding Family concierge funnel AND the product-discovery survey.
//
//   POST                    { email, style?, note?, source?, consent? }
//                           → { ok, id, token }  (token authorizes ?action=photo)
//   POST ?action=photo      { id, token, image: dataURL, name? }
//                           → { ok, count }      (consented family photos)
//   POST ?action=survey     { id?, token?, answers: {...}, complete? }
//                           → { ok, id, token }  (progressive save — see below)
//   GET  ?action=founding-status
//                           → { ok, open }       (public: Founding-100 sold out?)
//   GET                     admin-only review: rows + paid state + photo keys
//
// The survey (/survey) saves PROGRESSIVELY: the first answered question
// creates a row and mints an HMAC row token; every later section re-sends the
// full answer state under that token. That gives the dashboard a real
// started→completed funnel and keeps partial answers when someone bails at
// question 12. Payment fields (founding_family, payment_status, cohort…) are
// NEVER client-writable — only the Stripe webhook (store.js) sets them.
// POST is intentionally open — it's the public form. Photo uploads are the
// SENSITIVE part (families upload pictures of their kids before any account
// or COPPA consent screen exists), so they are fenced four ways:
//   1. CONSENT — the row must carry the form's parent/guardian consent
//      checkbox before a single photo is accepted, and the consent text
//      version is stored with it.
//   2. TOKEN — photos attach only via an HMAC token minted by THAT row's
//      POST (2-hour expiry), so nobody can spray photos onto other rows.
//   3. CAPS — max 8 photos per signup, ~4MB each, image content-types only.
//   4. PRIVATE — blobs live under waitlist/<id>/, which /api/media serves
//      to ADMINS ONLY (not the usual any-authenticated-user library rule).
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const WAITLIST_CONSENT_VERSION = '2026-08';

export async function ensureWaitlist(db) {
  await db`
    CREATE TABLE IF NOT EXISTS waitlist (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      style TEXT,
      note TEXT,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS waitlist_email_idx   ON waitlist(email)`;
  await db`CREATE INDEX IF NOT EXISTS waitlist_created_idx ON waitlist(created_at DESC)`;
  // Concierge funnel columns (additive — pre-migration rows read as unpaid).
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS photo_consent TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS paid_sku TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS invite_code TEXT`;
  await db`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS linked_user_id BIGINT`;
  await db`
    CREATE TABLE IF NOT EXISTS waitlist_photos (
      id BIGSERIAL PRIMARY KEY,
      waitlist_id BIGINT NOT NULL,
      blob_key TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS waitlist_photos_row_idx ON waitlist_photos(waitlist_id)`;
}

// ── Product-discovery survey ────────────────────────────────────────────────
// One row per survey session, one COLUMN per answer (never a JSON blob of the
// whole form) so the dashboard can aggregate with plain SQL/JS. Multi-selects
// are JSONB arrays of option keys. Canonical DDL also lives in api/init.js.
export const SURVEY_VERSION = '2026-08-v1';
export const FOUNDING_CAP = 100;   // default priority-cohort size (see foundingCaps)

// Founding capacity — TWO thresholds, both admin-adjustable (Lab settings):
//   priorityCap (default 100)  — the first N PAID deposits are the priority
//                                cohort ("Founding Family #N", set up first).
//   orderCap    (default 1000) — the hard stop: deposit-taking disables
//                                entirely at N paid orders so a viral night
//                                can't sell unlimited discounted boards.
// Counted by PAID rows only — reserving (account + photos, no deposit) never
// consumes a slot. Falls back to the defaults when settings are unreadable.
export async function foundingCaps(db) {
  let priorityCap = 100, orderCap = 1000;
  try {
    const r = (await db`SELECT founding_priority_cap, founding_order_cap FROM lab_settings WHERE id = 1`)[0];
    if (r && Number(r.founding_priority_cap) > 0) priorityCap = Number(r.founding_priority_cap);
    if (r && Number(r.founding_order_cap) > 0) orderCap = Number(r.founding_order_cap);
  } catch (_) { /* pre-migration settings — defaults hold */ }
  return { priorityCap, orderCap };
}

export async function foundingPaidCount(db) {
  try {
    return Number((await db`
      SELECT COUNT(*)::int AS n FROM survey_responses
      WHERE cohort = 'founding_100' AND payment_status = 'paid'`)[0]?.n) || 0;
  } catch (_) { return 0; }
}

export async function ensureSurvey(db) {
  await db`
    CREATE TABLE IF NOT EXISTS survey_responses (
      id BIGSERIAL PRIMARY KEY,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      survey_version TEXT,
      source TEXT,
      email  TEXT,
      respondent_type TEXT,
      -- family branch
      child_age_range TEXT,
      communication_methods JSONB,
      spoken_language_level TEXT,
      current_aac_system TEXT,
      current_aac_other TEXT,
      current_aac_likes TEXT,
      current_aac_frustrations TEXT,
      interests JSONB,
      preferred_shows_books_styles JSONB,
      family_goals JSONB,
      family_goal_other TEXT,
      six_month_goal_text TEXT,
      preferred_purchase_tier TEXT,
      purchase_value_drivers JSONB,
      purchase_value_text TEXT,
      subscription_preference TEXT,
      language_interest TEXT,
      languages_requested JSONB,
      language_other TEXT,
      language_use_cases JSONB,
      sign_language_interest TEXT,
      sign_features_requested JSONB,
      signed_language_requested TEXT,
      signed_language_other TEXT,
      behavior_books_interest TEXT,
      behavior_book_topics JSONB,
      behavior_book_other TEXT,
      data_sharing_interest TEXT,
      founding_purchase_interest TEXT,
      -- payment (webhook-only writes; see store.js handleFoundingPaid)
      founding_family BOOLEAN NOT NULL DEFAULT FALSE,
      founding_purchase_price NUMERIC(10,2),
      cohort TEXT,
      payment_status TEXT,
      stripe_session_id TEXT,
      stripe_customer_id TEXT,
      paid_at TIMESTAMPTZ,
      -- professional branch
      professional_role TEXT,
      organization TEXT,
      professional_website TEXT,
      professional_email TEXT,
      professional_phone TEXT,
      potential_children_served TEXT,
      professional_age_ranges JSONB,
      professional_aac_systems JSONB,
      professional_aac_other TEXT,
      professional_problems_text TEXT,
      professional_feature_interests JSONB,
      professional_time_saver_text TEXT,
      professional_purchasing_model TEXT,
      volume_license_interest TEXT,
      estimated_license_volume TEXT,
      pilot_willingness TEXT,
      direct_contact_willingness TEXT,
      preferred_contact_text TEXT,
      evaluation_program_interest TEXT,
      professional_pilot_candidate BOOLEAN NOT NULL DEFAULT FALSE,
      -- general-interest branch
      general_interest_text TEXT,
      general_for_whom TEXT,
      feature_interests JSONB,
      -- everyone
      marketing_permissions JSONB,
      early_access_interest BOOLEAN NOT NULL DEFAULT FALSE
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS survey_email_idx   ON survey_responses(email)`;
  await db`CREATE INDEX IF NOT EXISTS survey_created_idx ON survey_responses(created_at DESC)`;
  // Additive columns for tables created before these questions existed.
  await db`ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS behavior_books_interest TEXT`;
  await db`ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS behavior_book_topics JSONB`;
  await db`ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS behavior_book_other TEXT`;
  // Funnel v2 (survey-gated signup): the account this survey created, the
  // family's paid deposit rank, and the professional clinic address (for the
  // future geo-tagged clinic-boards feature).
  await db`ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS linked_user_id BIGINT`;
  await db`ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS founding_rank INT`;
  await db`ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS professional_address TEXT`;
}

// ── Row token: lets the JUST-SUBMITTED form attach photos to its own row and
//    start its own checkout — nothing else. HMAC over the row id + expiry
//    with SESSION_SECRET (same secret the session cookies trust).
function tokenSecret() { return process.env.SESSION_SECRET || ''; }

export function mintWaitlistToken(id, exp = Date.now() + TOKEN_TTL_MS) {
  const secret = tokenSecret();
  if (!secret) return null;
  const sig = createHmac('sha256', secret).update(`wl:${id}:${exp}`).digest('hex').slice(0, 40);
  return `${id}.${exp}.${sig}`;
}

export function verifyWaitlistToken(token, id) {
  const secret = tokenSecret();
  if (!secret || typeof token !== 'string') return false;
  const [tid, texp, sig] = token.split('.');
  if (String(tid) !== String(id)) return false;
  const exp = Number(texp);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expect = createHmac('sha256', secret).update(`wl:${id}:${exp}`).digest('hex').slice(0, 40);
  try { return timingSafeEqual(Buffer.from(expect), Buffer.from(String(sig || ''))); } catch (_) { return false; }
}

// Survey row token — same HMAC recipe with a DIFFERENT prefix ('sv:' vs 'wl:')
// so a waitlist token can never update a survey row or vice versa. Longer TTL:
// a parent may leave the tab open and finish (or pay) hours later.
const SURVEY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function mintSurveyToken(id, exp = Date.now() + SURVEY_TOKEN_TTL_MS) {
  const secret = tokenSecret();
  if (!secret) return null;
  const sig = createHmac('sha256', secret).update(`sv:${id}:${exp}`).digest('hex').slice(0, 40);
  return `${id}.${exp}.${sig}`;
}

export function verifySurveyToken(token, id) {
  const secret = tokenSecret();
  if (!secret || typeof token !== 'string') return false;
  const [tid, texp, sig] = token.split('.');
  if (String(tid) !== String(id)) return false;
  const exp = Number(texp);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expect = createHmac('sha256', secret).update(`sv:${id}:${exp}`).digest('hex').slice(0, 40);
  try { return timingSafeEqual(Buffer.from(expect), Buffer.from(String(sig || ''))); } catch (_) { return false; }
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '');
  if (req.method === 'GET') {
    if (action === 'founding-status') return foundingStatus(req, res);
    return list(req, res);
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (action === 'photo') return photo(req, res);
  if (action === 'survey') return survey(req, res);
  return join(req, res);
}

async function join(req, res) {
  const body = (typeof req.body === 'object' && req.body) || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ error: 'Valid email required' });
    return;
  }
  const style  = typeof body.style  === 'string' ? body.style.slice(0, 60)  : null;
  const note   = typeof body.note   === 'string' ? body.note.slice(0, 1000) : null;
  const source = typeof body.source === 'string' ? body.source.slice(0, 60) : 'landing';
  // The photo-consent checkbox. Stored as the consent VERSION so a future
  // wording change is distinguishable from an old agreement.
  const consent = body.consent === true ? WAITLIST_CONSENT_VERSION : null;

  try {
    const db = sql();
    await ensureWaitlist(db);
    const ins = await db`
      INSERT INTO waitlist (email, style, note, source, photo_consent)
      VALUES (${email}, ${style}, ${note}, ${source}, ${consent})
      RETURNING id
    `;
    const id = Number(ins[0].id);
    res.status(200).json({ ok: true, id, token: mintWaitlistToken(id) });
  } catch (err) {
    res.status(500).json({ error: 'Save failed', detail: String(err.message || err) });
  }
}

// dataURL → { buffer, contentType } for the three image types we accept.
function decodeImageDataURL(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  if (!m) return null;
  try {
    const buffer = Buffer.from(m[2], 'base64');
    return buffer.length ? { buffer, contentType: m[1] } : null;
  } catch (_) { return null; }
}

async function photo(req, res) {
  const body = (typeof req.body === 'object' && req.body) || {};
  const id = Number(body.id) || 0;
  if (!id || !verifyWaitlistToken(body.token, id)) {
    res.status(401).json({ error: 'bad or expired token' });
    return;
  }
  const img = decodeImageDataURL(body.image);
  if (!img) { res.status(400).json({ error: 'image must be a jpeg/png/webp data URL' }); return; }
  if (img.buffer.length > MAX_PHOTO_BYTES) {
    res.status(400).json({ error: 'photo too large (4MB max — the form downscales, so this should not happen)' });
    return;
  }
  try {
    const db = sql();
    await ensureWaitlist(db);
    const row = (await db`SELECT id, photo_consent FROM waitlist WHERE id = ${id} LIMIT 1`)[0];
    if (!row) { res.status(404).json({ error: 'signup not found' }); return; }
    // No consent on the row → no photos, full stop.
    if (!row.photo_consent) {
      res.status(403).json({ error: 'consent_required',
        detail: 'Photos need the parent/guardian consent box checked on the form.' });
      return;
    }
    const count = Number((await db`SELECT COUNT(*)::int AS n FROM waitlist_photos WHERE waitlist_id = ${id}`)[0]?.n) || 0;
    if (count >= MAX_PHOTOS) { res.status(400).json({ error: `photo limit reached (${MAX_PHOTOS})` }); return; }
    const ext = img.contentType === 'image/png' ? 'png' : img.contentType === 'image/webp' ? 'webp' : 'jpg';
    const key = `waitlist/${id}/${randomUUID()}.${ext}`;
    await put(key, img.buffer, { access: 'private', contentType: img.contentType, addRandomSuffix: false });
    const name = typeof body.name === 'string' ? body.name.slice(0, 120) : null;
    await db`INSERT INTO waitlist_photos (waitlist_id, blob_key, name) VALUES (${id}, ${key}, ${name})`;
    res.status(200).json({ ok: true, count: count + 1 });
  } catch (err) {
    res.status(500).json({ error: 'photo save failed', detail: String(err.message || err) });
  }
}

// ── Survey save ─────────────────────────────────────────────────────────────
// Server-side normalization: enums are allow-listed, free text is capped,
// multi-selects become bounded arrays of trimmed strings. Anything that fails
// validation stores as NULL rather than erroring — a survey must never eat a
// family's answers over one malformed field.
function sTxt(v, cap) {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, cap);
  return t || null;
}
function sArr(v, maxItems = 24, itemCap = 120) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const t = x.trim().slice(0, itemCap);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out.length ? out : null;
}
function sEnum(v, allowed) { return typeof v === 'string' && allowed.includes(v) ? v : null; }
const jb = (a) => (a ? JSON.stringify(a) : null);   // JSONB param helper

const RESPONDENT_TYPES = ['parent', 'slp', 'ot', 'teacher', 'clinic', 'professional_other', 'general'];
const YMN   = ['yes', 'maybe', 'no'];
const TIERS = ['essential', 'personalized', 'bespoke', 'none_affordable', 'not_ready'];
const SUBS  = ['essentials', 'plus', 'pro', 'no_subscription', 'not_sure', 'none'];
const SIGN_INTEREST = ['definitely', 'probably', 'maybe', 'no'];

async function survey(req, res) {
  const body = (typeof req.body === 'object' && req.body) || {};
  const a = (typeof body.answers === 'object' && body.answers) || {};
  try {
    const db = sql();
    await ensureWaitlist(db);
    await ensureSurvey(db);

    let id = Number(body.id) || 0;
    if (id) {
      if (!verifySurveyToken(body.token, id)) {
        res.status(401).json({ error: 'bad or expired survey token — refresh the page to start over' });
        return;
      }
    } else {
      const rt = sEnum(a.respondent_type, RESPONDENT_TYPES);
      if (!rt) { res.status(400).json({ error: 'respondent_type required to start' }); return; }
      const source = sTxt(body.source, 60) || 'survey';
      const ins = await db`
        INSERT INTO survey_responses (survey_version, source, respondent_type)
        VALUES (${SURVEY_VERSION}, ${source}, ${rt}) RETURNING id`;
      id = Number(ins[0].id);
    }

    const email = sTxt(a.email, 254);
    const validEmail = email && EMAIL_RE.test(email) ? email.toLowerCase() : null;
    const marketing = sArr(a.marketing_permissions, 12, 60);
    // Derived flags (spec fields) — computed here, not trusted from the client.
    const pilotCandidate = sEnum(a.evaluation_program_interest, YMN) === 'yes';
    const earlyAccess = !!(marketing && marketing.includes('early_access'))
      || sEnum(a.founding_purchase_interest, YMN) === 'yes';

    // One static UPDATE of every client-writable column — the page re-sends
    // its whole answer state each save, so absent answers simply write NULL
    // again. Payment columns are deliberately NOT in this list.
    await db`
      UPDATE survey_responses SET
        updated_at = NOW(),
        email = ${validEmail},
        respondent_type = ${sEnum(a.respondent_type, RESPONDENT_TYPES)},
        child_age_range = ${sTxt(a.child_age_range, 30)},
        communication_methods = ${jb(sArr(a.communication_methods))},
        spoken_language_level = ${sTxt(a.spoken_language_level, 80)},
        current_aac_system = ${sTxt(a.current_aac_system, 60)},
        current_aac_other = ${sTxt(a.current_aac_other, 120)},
        current_aac_likes = ${sTxt(a.current_aac_likes, 2000)},
        current_aac_frustrations = ${sTxt(a.current_aac_frustrations, 2000)},
        interests = ${jb(sArr(a.interests))},
        preferred_shows_books_styles = ${jb(sArr(a.preferred_shows_books_styles, 24, 80))},
        family_goals = ${jb(sArr(a.family_goals, 5, 80))},
        family_goal_other = ${sTxt(a.family_goal_other, 200)},
        six_month_goal_text = ${sTxt(a.six_month_goal_text, 2000)},
        preferred_purchase_tier = ${sEnum(a.preferred_purchase_tier, TIERS)},
        purchase_value_drivers = ${jb(sArr(a.purchase_value_drivers, 3, 60))},
        purchase_value_text = ${sTxt(a.purchase_value_text, 2000)},
        subscription_preference = ${sEnum(a.subscription_preference, SUBS)},
        language_interest = ${sEnum(a.language_interest, YMN)},
        languages_requested = ${jb(sArr(a.languages_requested, 24, 60))},
        language_other = ${sTxt(a.language_other, 120)},
        language_use_cases = ${jb(sArr(a.language_use_cases, 12, 80))},
        sign_language_interest = ${sEnum(a.sign_language_interest, SIGN_INTEREST)},
        sign_features_requested = ${jb(sArr(a.sign_features_requested, 12, 80))},
        signed_language_requested = ${sTxt(a.signed_language_requested, 40)},
        signed_language_other = ${sTxt(a.signed_language_other, 120)},
        behavior_books_interest = ${sEnum(a.behavior_books_interest, SIGN_INTEREST)},
        behavior_book_topics = ${jb(sArr(a.behavior_book_topics, 16, 80))},
        behavior_book_other = ${sTxt(a.behavior_book_other, 200)},
        data_sharing_interest = ${sEnum(a.data_sharing_interest, YMN)},
        founding_purchase_interest = ${sEnum(a.founding_purchase_interest, YMN)},
        professional_role = ${sTxt(a.professional_role, 60)},
        organization = ${sTxt(a.organization, 200)},
        professional_website = ${sTxt(a.professional_website, 254)},
        professional_email = ${sTxt(a.professional_email, 254)},
        professional_phone = ${sTxt(a.professional_phone, 40)},
        professional_address = ${sTxt(a.professional_address, 300)},
        potential_children_served = ${sTxt(a.potential_children_served, 20)},
        professional_age_ranges = ${jb(sArr(a.professional_age_ranges, 10, 30))},
        professional_aac_systems = ${jb(sArr(a.professional_aac_systems, 24, 60))},
        professional_aac_other = ${sTxt(a.professional_aac_other, 200)},
        professional_problems_text = ${sTxt(a.professional_problems_text, 2000)},
        professional_feature_interests = ${jb(sArr(a.professional_feature_interests, 20, 60))},
        professional_time_saver_text = ${sTxt(a.professional_time_saver_text, 2000)},
        professional_purchasing_model = ${sTxt(a.professional_purchasing_model, 80)},
        volume_license_interest = ${sEnum(a.volume_license_interest, YMN)},
        estimated_license_volume = ${sTxt(a.estimated_license_volume, 20)},
        pilot_willingness = ${sEnum(a.pilot_willingness, YMN)},
        direct_contact_willingness = ${sEnum(a.direct_contact_willingness, YMN)},
        preferred_contact_text = ${sTxt(a.preferred_contact_text, 300)},
        evaluation_program_interest = ${sEnum(a.evaluation_program_interest, YMN)},
        professional_pilot_candidate = ${pilotCandidate},
        general_interest_text = ${sTxt(a.general_interest_text, 2000)},
        general_for_whom = ${sTxt(a.general_for_whom, 120)},
        feature_interests = ${jb(sArr(a.feature_interests, 20, 60))},
        marketing_permissions = ${jb(marketing)},
        early_access_interest = ${earlyAccess}
      WHERE id = ${id}`;

    if (body.complete === true) {
      await db`UPDATE survey_responses SET completed_at = COALESCE(completed_at, NOW()) WHERE id = ${id}`;
      // A completed survey with an email joins the plain waitlist too (unless
      // that email is already on it) so "total waitlist" stays one number.
      if (validEmail) {
        const ex = await db`SELECT id FROM waitlist WHERE email = ${validEmail} LIMIT 1`;
        if (!ex.length) {
          await db`INSERT INTO waitlist (email, source) VALUES (${validEmail}, 'survey')`;
        }
      }
    }

    res.status(200).json({ ok: true, id, token: mintSurveyToken(id) });
  } catch (err) {
    res.status(500).json({ error: 'Save failed', detail: String(err.message || err) });
  }
}

// Public capacity probe for the founding funnel. Deliberately returns only
// booleans — exact counts stay admin-only (dashboard):
//   open     — deposits are still being taken (paid < orderCap)
//   priority — the NEXT paid deposit lands inside the priority cohort
//              ("you'd be in the first hundred")
async function foundingStatus(req, res) {
  try {
    const db = sql();
    await ensureSurvey(db);
    const n = await foundingPaidCount(db);
    const { priorityCap, orderCap } = await foundingCaps(db);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, open: n < orderCap, priority: n < priorityCap });
  } catch (err) {
    // Fail OPEN like founding.html's capacity probe — checkout re-enforces
    // the cap server-side, so a DB hiccup here must not hide the offer.
    res.status(200).json({ ok: true, open: true, priority: false });
  }
}

async function list(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  if (auth.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: admin role required' });
    return;
  }
  try {
    const db = sql();
    await ensureWaitlist(db);
    const rows = await db`
      SELECT id, email, style, note, source, created_at, photo_consent,
             paid_at, paid_sku, invite_code, linked_user_id
      FROM waitlist ORDER BY created_at DESC LIMIT 500`;
    const photos = await db`
      SELECT waitlist_id, blob_key FROM waitlist_photos
      WHERE waitlist_id = ANY(${rows.map((r) => Number(r.id))})
      ORDER BY id`;
    const byRow = new Map();
    for (const p of photos) {
      const k = Number(p.waitlist_id);
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k).push(p.blob_key);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      waitlist: rows.map((r) => ({ ...r, photos: byRow.get(Number(r.id)) || [] })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Load failed', detail: String(err.message || err) });
  }
}
