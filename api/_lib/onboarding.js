// Shared core for the onboarding endpoints (state / child / family / seed-core
// / complete). Holds the step ordering, the progress upsert, and a couple of
// shared helpers so the per-step files stay small.
import { randomUUID } from 'node:crypto';
import { sql } from './db.js';

// The canonical step ordering. Both clients (SwiftUI + web) walk this list.
// Final value 'complete' means the parent has finished onboarding.
export const ORDER = ['account', 'child', 'child_photo', 'parent_photo', 'scene_keystone', 'seed_core', 'complete'];

export function nextStep(current) {
  const i = ORDER.indexOf(current);
  if (i < 0 || i >= ORDER.length - 1) return 'complete';
  return ORDER[i + 1];
}

export async function ensureProgress(db, user) {
  const uid = Number(user.uid || user.id);
  if (!uid) throw new Error('signed-in user missing id');
  // Upsert a row on first read so the rest of the flow can just UPDATE it.
  const existing = await db`SELECT user_id, child_id, step, data FROM onboarding_progress WHERE user_id = ${uid} LIMIT 1`;
  if (existing.length) return existing[0];
  const childId = user.slug || `parent-${uid}`;
  // Legacy detection: accounts from before progress-tracking (or boards an
  // admin hand-built) have no row but a fully populated board. Creating
  // their first row at 'account' would read as "never onboarded" and
  // auto-resume flows would bounce ESTABLISHED families into the wizard.
  // A board only gains items at the seed step (the end of onboarding), so
  // any real item count means they finished.
  let firstStep = 'account';
  try {
    const n = (await db`SELECT COUNT(*)::int AS n FROM items WHERE child_id = ${childId}`)[0]?.n || 0;
    if (n > 12) firstStep = 'complete';
  } catch (_) { /* items table missing pre-init — 'account' is right */ }
  const created = await db`
    INSERT INTO onboarding_progress (user_id, child_id, step, data)
    VALUES (${uid}, ${childId}, ${firstStep}, '{}'::jsonb)
    RETURNING user_id, child_id, step, data`;
  return created[0];
}

export async function setStep(db, uid, step, dataPatch = null) {
  if (dataPatch) {
    await db`
      UPDATE onboarding_progress
         SET step = ${step},
             data = COALESCE(data, '{}'::jsonb) || ${JSON.stringify(dataPatch)}::jsonb,
             updated_at = NOW()
       WHERE user_id = ${uid}`;
  } else {
    await db`UPDATE onboarding_progress SET step = ${step}, updated_at = NOW() WHERE user_id = ${uid}`;
  }
}

// Tier (attention budget) → auto-teach defaults. Used when seeding child_settings.
export const TIER_LABELS = new Set(['under3', '3to5', '5plus']);

// Languages the onboarding UI offers. English ships day one; the others are
// placeholders so a parent can pick their language preference now and the
// content layer fills in once the translations land.
export const LANGUAGE_LABELS = new Set(['en', 'es', 'fr', 'pt', 'de', 'zh']);

// Core taxonomy band defaults to the FIRST set we'll auto-seed for new
// children. Recommendation per user: only Core 12-18m. ~13 tiles, ~$0.52 in
// Nano Banana cost; leaves the bulk of the parent's monthly credit cap for
// household items they snap themselves.
export const SEED_BAND = '12-18m';
export const SEED_CATEGORY = 'Core';

// ── Multi-child accounts (DARK LAUNCH) ──────────────────────────────────────
// One login owns MANY boards through child_access (relation 'parent') — the
// same roster therapists already use. The first child's slug doubles as the
// account slug (sessions carry it); every LATER child gets a generated slug
// and exists only in the roster. While MULTI_CHILD_PUBLIC is false, only
// admin accounts can add a second child (owner field-testing). Flipping the
// flag is the whole graduation — the roster, isolation, and per-child
// subscription stamping beneath it are always on.
export const MULTI_CHILD_PUBLIC = false;
export const multiChildAllowed = (user) =>
  MULTI_CHILD_PUBLIC || !!(user && user.role === 'admin');

// Every board this account PARENTS, oldest first (the roster is the truth —
// users.slug only names the first/legacy child). Display name comes from the
// board's is_self person; a mid-onboarding child has none yet.
export async function childrenOf(db, uid) {
  if (!Number(uid)) return [];
  try {
    const rows = await db`
      SELECT ca.child_id,
             COALESCE(p.given_name, p.display_name) AS name
        FROM child_access ca
   LEFT JOIN persons p ON p.child_id = ca.child_id AND p.is_self = TRUE
       WHERE ca.user_id = ${Number(uid)} AND ca.relation = 'parent' AND ca.status = 'active'
    ORDER BY ca.created_at ASC NULLS LAST, ca.child_id ASC`;
    return rows.map((r) => ({ childId: r.child_id, name: r.name || null }));
  } catch (_) { return []; }
}

// A fresh board slug for an added child. Deliberately NOT derived from the
// child's name (the name arrives later in the flow, and slugs are permanent
// identity — see /u/<slug> routing); 'k' prefix keeps it a valid slug that
// can never collide with an account-derived one.
export function newChildSlug() {
  return 'k' + randomUUID().replace(/-/g, '').slice(0, 12);
}
