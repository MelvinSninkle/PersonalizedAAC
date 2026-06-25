// Shared core for the onboarding endpoints (state / child / family / seed-core
// / complete). Holds the step ordering, the progress upsert, and a couple of
// shared helpers so the per-step files stay small.
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
  const created = await db`
    INSERT INTO onboarding_progress (user_id, child_id, step, data)
    VALUES (${uid}, ${childId}, 'account', '{}'::jsonb)
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
export const LANGUAGE_LABELS = new Set(['en', 'es', 'fr', 'pt', 'de']);

// Core taxonomy band defaults to the FIRST set we'll auto-seed for new
// children. Recommendation per user: only Core 12-18m. ~13 tiles, ~$0.52 in
// Nano Banana cost; leaves the bulk of the parent's monthly credit cap for
// household items they snap themselves.
export const SEED_BAND = '12-18m';
export const SEED_CATEGORY = 'Core';
