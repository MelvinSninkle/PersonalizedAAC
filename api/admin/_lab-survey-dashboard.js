// /api/admin/lab?action=survey-dashboard  (admin only)
//
// The analysis half of the /survey funnel — one GET returns every aggregate
// the admin survey dashboard renders, so the page paints in a single round
// trip. Nothing here is raw-row dumping except the capped free-text lists;
// the point (per the survey spec) is that 500 completions read as EVIDENCE:
// "31% prefer $49.99, Spanish is requested by 22%, 64 families mentioned the
// same three visual worlds", not 500 email addresses.
//
//   GET →
//     founding      { paid, cap, remaining } — the FOUNDING FAMILIES n/100 counter
//     demand        waitlist total, surveys started/completed, respondent split,
//                   founding purchases, completion + paid conversion rates
//     pricing       one-time tier counts, subscription counts, tier × subscription
//                   cross-tab (both recorded independently, per the spec)
//     product       ranked family goals, current AAC systems, value drivers,
//                   professional + general feature interests
//     styles        requested shows/books/visual worlds, grouped by a normalized
//                   key (case/punctuation/plural folding) with raw variants —
//                   the dashboard applies its configurable demand threshold
//     languages     interest split, ranked languages, ranked use cases
//     sign          interest split, ranked signed languages, ranked features
//     professional  totals, role split, estimated children represented (range
//                   midpoints), pilot candidates (the high-priority leads),
//                   purchasing model + license volume demand
//     cohort        early-access funnel: willing → interested → checkout
//                   started → paid → remaining seats
//     texts         capped free-text lists (frustrations, six-month hopes,
//                   worth-the-price, time savers, AAC problems)
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { maxDuration: 60 };

const ROW_CAP = 5000;    // aggregate over at most this many newest responses
const TEXT_CAP = 100;    // free-text answers per list

// Range midpoints for "children served" → estimated children represented.
// Keys match the survey's option labels exactly (en dashes included).
const CHILDREN_MID = { '1–5': 3, '6–10': 8, '11–25': 18, '26–50': 38, '51–100': 75, '100+': 150 };

function tally(rows, pick) {
  const m = new Map();
  for (const r of rows) {
    const v = pick(r);
    if (v == null || v === '') continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}
function tallyArr(rows, pick) {
  const m = new Map();
  for (const r of rows) {
    const a = pick(r);
    if (!Array.isArray(a)) continue;
    for (const v of a) {
      if (typeof v !== 'string' || !v) continue;
      m.set(v, (m.get(v) || 0) + 1);
    }
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}
function texts(rows, pick) {
  const out = [];
  for (const r of rows) {
    const t = pick(r);
    if (typeof t === 'string' && t.trim()) out.push({ t: t.trim().slice(0, 500), at: r.created_at });
    if (out.length >= TEXT_CAP) break;
  }
  return out;
}

// "Bluey", "bluey!", "Blueys" → one bucket. Deliberately conservative: fold
// case, punctuation, whitespace, a leading article, and a plain trailing "s".
// Anything cleverer (edit distance) risks merging distinct worlds.
function styleKey(s) {
  let k = String(s).normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (k.startsWith('the ')) k = k.slice(4);
  if (k.length > 3 && k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1);
  return k;
}

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const db = sql();

  try {
    const { ensureWaitlist, ensureSurvey, FOUNDING_CAP } = await import('../waitlist.js');
    try { await ensureWaitlist(db); await ensureSurvey(db); } catch (_) {}

    const rows = await db`
      SELECT id, created_at, completed_at, survey_version, email, respondent_type,
             child_age_range, communication_methods, spoken_language_level,
             current_aac_system, current_aac_other, current_aac_likes, current_aac_frustrations,
             interests, preferred_shows_books_styles, family_goals, family_goal_other,
             six_month_goal_text, preferred_purchase_tier, purchase_value_drivers,
             purchase_value_text, subscription_preference,
             language_interest, languages_requested, language_use_cases,
             sign_language_interest, sign_features_requested, signed_language_requested,
             behavior_books_interest, behavior_book_topics, behavior_book_other,
             data_sharing_interest, founding_purchase_interest, founding_family,
             cohort, payment_status, paid_at,
             professional_role, organization, professional_website, professional_email,
             professional_phone, potential_children_served, professional_aac_systems,
             professional_problems_text, professional_feature_interests,
             professional_time_saver_text, professional_purchasing_model,
             volume_license_interest, estimated_license_volume, pilot_willingness,
             direct_contact_willingness, preferred_contact_text, evaluation_program_interest,
             professional_pilot_candidate, general_interest_text, general_for_whom,
             feature_interests, marketing_permissions, early_access_interest
      FROM survey_responses ORDER BY created_at DESC LIMIT ${ROW_CAP}`;

    const waitlistTotal = Number((await db`SELECT COUNT(*)::int AS n FROM waitlist`)[0]?.n) || 0;

    const completed = rows.filter((r) => r.completed_at);
    const families = rows.filter((r) => r.respondent_type === 'parent');
    const pros = rows.filter((r) => ['slp', 'ot', 'teacher', 'clinic', 'professional_other'].includes(r.respondent_type));
    const paidRows = rows.filter((r) => r.payment_status === 'paid' && r.cohort === 'founding_100');

    // FOUNDING n/100 — counted straight from the DB (not the capped row set)
    // so the counter is exact even past ROW_CAP.
    const paidCount = Number((await db`
      SELECT COUNT(*)::int AS n FROM survey_responses
      WHERE cohort = 'founding_100' AND payment_status = 'paid'`)[0]?.n) || 0;

    // Styles: group by normalized key, keep raw variants for the admin eye.
    const styleMap = new Map();
    for (const r of rows) {
      if (!Array.isArray(r.preferred_shows_books_styles)) continue;
      for (const raw of r.preferred_shows_books_styles) {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const key = styleKey(raw);
        if (!key) continue;
        const e = styleMap.get(key) || { key, count: 0, variants: new Map() };
        e.count += 1;
        e.variants.set(raw.trim(), (e.variants.get(raw.trim()) || 0) + 1);
        styleMap.set(key, e);
      }
    }
    const styles = [...styleMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 200)
      .map((e) => {
        const variants = [...e.variants.entries()].sort((a, b) => b[1] - a[1]);
        return { key: e.key, label: variants[0][0], count: e.count, variants: variants.map(([v, n]) => ({ v, n })) };
      });

    // Purchase tier × subscription cross-tab (family rows with both answered).
    const cross = {};
    for (const r of families) {
      if (!r.preferred_purchase_tier || !r.subscription_preference) continue;
      const k = r.preferred_purchase_tier + '|' + r.subscription_preference;
      cross[k] = (cross[k] || 0) + 1;
    }

    // Estimated children represented across professionals (range midpoints).
    let childrenRepresented = 0;
    for (const r of pros) childrenRepresented += CHILDREN_MID[r.potential_children_served] || 0;

    const pilotCandidates = pros
      .filter((r) => r.professional_pilot_candidate || r.pilot_willingness === 'yes')
      .slice(0, TEXT_CAP)
      .map((r) => ({
        id: Number(r.id), created_at: r.created_at,
        role: r.professional_role, organization: r.organization,
        email: r.professional_email || r.email, phone: r.professional_phone,
        website: r.professional_website, children: r.potential_children_served,
        contact: r.preferred_contact_text,
        evaluation: r.evaluation_program_interest, pilot: r.pilot_willingness,
      }));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      rowCap: ROW_CAP, rowCount: rows.length,
      founding: { paid: paidCount, cap: FOUNDING_CAP, remaining: Math.max(0, FOUNDING_CAP - paidCount) },
      demand: {
        waitlistTotal,
        surveysStarted: rows.length,
        surveysCompleted: completed.length,
        completionRate: rows.length ? completed.length / rows.length : 0,
        byType: Object.fromEntries(tally(rows, (r) => r.respondent_type).map((x) => [x.value, x.count])),
        families: families.length,
        professionals: pros.length,
        foundingPurchases: paidCount,
        paidConversionOfFamilies: families.length ? paidRows.length / families.length : 0,
      },
      pricing: {
        purchaseTier: tally(families, (r) => r.preferred_purchase_tier),
        subscription: tally(families, (r) => r.subscription_preference),
        cross,
        valueDrivers: tallyArr(families, (r) => r.purchase_value_drivers),
      },
      product: {
        goals: tallyArr(families, (r) => r.family_goals),
        aacSystems: tally(families, (r) => r.current_aac_system),
        proAacSystems: tallyArr(pros, (r) => r.professional_aac_systems),
        communicationMethods: tallyArr(families, (r) => r.communication_methods),
        spokenLevels: tally(families, (r) => r.spoken_language_level),
        ages: tally(families, (r) => r.child_age_range),
        interests: tallyArr(families, (r) => r.interests),
        proFeatures: tallyArr(pros, (r) => r.professional_feature_interests),
        generalFeatures: tallyArr(rows, (r) => r.feature_interests),
      },
      styles,
      languages: {
        interest: tally(rows, (r) => r.language_interest),
        requested: tallyArr(rows, (r) => r.languages_requested),
        useCases: tallyArr(families, (r) => r.language_use_cases),
      },
      sign: {
        interest: tally(rows, (r) => r.sign_language_interest),
        requested: tally(rows, (r) => r.signed_language_requested),
        features: tallyArr(families, (r) => r.sign_features_requested),
      },
      books: {
        interest: tally(families, (r) => r.behavior_books_interest),
        topics: tallyArr(families, (r) => r.behavior_book_topics),
        otherTopics: texts(families, (r) => r.behavior_book_other),
      },
      professional: {
        total: pros.length,
        byRole: tally(pros, (r) => r.professional_role),
        childrenRepresented,
        childrenServed: tally(pros, (r) => r.potential_children_served),
        purchasingModel: tally(pros, (r) => r.professional_purchasing_model),
        volumeInterest: tally(pros, (r) => r.volume_license_interest),
        licenseVolume: tally(pros, (r) => r.estimated_license_volume),
        pilotWillingness: tally(pros, (r) => r.pilot_willingness),
        evaluationInterest: tally(pros, (r) => r.evaluation_program_interest),
        pilotCandidates,
      },
      cohort: {
        dataSharing: tally(families, (r) => r.data_sharing_interest),
        foundingInterest: tally(families, (r) => r.founding_purchase_interest),
        checkoutStarted: rows.filter((r) => r.payment_status === 'checkout_started').length,
        paid: paidCount,
        remaining: Math.max(0, FOUNDING_CAP - paidCount),
      },
      contact: {
        marketing: tallyArr(rows, (r) => r.marketing_permissions),
        earlyAccess: rows.filter((r) => r.early_access_interest).length,
        withEmail: rows.filter((r) => r.email).length,
      },
      texts: {
        frustrations: texts(families, (r) => r.current_aac_frustrations),
        likes: texts(families, (r) => r.current_aac_likes),
        sixMonth: texts(families, (r) => r.six_month_goal_text),
        worthIt: texts(families, (r) => r.purchase_value_text),
        proProblems: texts(pros, (r) => r.professional_problems_text),
        proTimeSavers: texts(pros, (r) => r.professional_time_saver_text),
        generalInterest: texts(rows, (r) => r.general_interest_text),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'survey dashboard failed', detail: String(err.message || err) });
  }
}
