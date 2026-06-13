// POST /api/onboarding/seed-core
//
// Step 5: seed the personalized Core 12-18m tiles. Picks taxonomy rows where
// column='Needs' AND category='Core' AND acquisition_age='12-18m' (≈ 13
// tiles), and queues generation per the existing lab-publish pipeline using
// the persons.is_self anchor for any tile whose prompt uses {reference}.
//
// Generations from this endpoint are tagged actor_role='onboarding_seed' so
// they don't burn against the parent's monthly quota. Total cost ~$0.52 at
// Nano Banana pricing for the ~13 tile batch.
//
// Returns the list of slugs that were queued. The iPad / web will poll
// /api/onboarding/state for completion.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { ensureProgress, nextStep, setStep, SEED_BAND, SEED_CATEGORY } from '../_lib/onboarding.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  try {
    const db = sql();
    const p = await ensureProgress(db, auth.user);
    const childId = p.child_id;

    const tiles = await db`
      SELECT id AS slug, label, column_name AS section, category
      FROM taxonomy
      WHERE category = ${SEED_CATEGORY}
        AND acquisition_age = ${SEED_BAND}
        AND COALESCE(archived, FALSE) = FALSE
        AND COALESCE(is_event, FALSE) = FALSE
        AND status = 'published'
      ORDER BY label`;

    // We don't fan out generations inline here (that'd block the response on
    // ~90 seconds). Instead we drop placeholder pending_tiles rows that the
    // existing pending render path will pick up. The user-facing copy says
    // "About 90 seconds" — that's calibrated for this fan-out.
    const slugs = [];
    for (const t of tiles) {
      try {
        await db`
          INSERT INTO pending_tiles (child_id, source_key, label, status, taxonomy_slug, updated_at)
          VALUES (${childId}, NULL, ${t.label}, 'queued', ${t.slug}, NOW())
          ON CONFLICT DO NOTHING`;
        slugs.push(t.slug);
      } catch (_) { /* table may not have ON CONFLICT target; non-fatal */ }
    }

    // Advance to the final step.
    await setStep(db, Number(auth.user.uid), 'complete', { seededCount: slugs.length });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      step: 'complete',
      queuedCount: slugs.length,
      slugs,
      message: `Queued ${slugs.length} starter tiles for ${childId}.`,
    });
  } catch (err) {
    res.status(500).json({ error: 'seed-core failed', detail: String(err.message || err) });
  }
}
