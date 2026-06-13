// POST /api/onboarding/child  { name, birthDate, tier }
//
// Step 2: the child's name + birth date + attention tier. Creates (or
// updates) the persons.is_self row for the slug, seeds child_settings.autoTeach
// to the chosen tier (still disabled — parent opts in later), and advances
// the onboarding step.
import { checkAuth } from '../_lib/auth.js';
import { isParentOf } from '../_lib/access.js';
import { sql } from '../_lib/db.js';
import { ensureProgress, nextStep, setStep, TIER_LABELS } from '../_lib/onboarding.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const name = String(b.name || '').slice(0, 80).trim();
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.birthDate || '')) ? String(b.birthDate) : null;
  const tier = TIER_LABELS.has(b.tier) ? b.tier : 'under3';
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  if (!birthDate) { res.status(400).json({ error: 'birthDate (YYYY-MM-DD) required' }); return; }

  try {
    const db = sql();
    const p = await ensureProgress(db, auth.user);
    const childId = p.child_id;
    // The parent of the child is the signed-in user. Insert a child_access
    // row if it doesn't exist (the first time they onboard).
    try {
      await db`
        INSERT INTO child_access (user_id, child_id, relation, status, created_at)
        VALUES (${Number(auth.user.uid)}, ${childId}, 'parent', 'active', NOW())
        ON CONFLICT DO NOTHING`;
    } catch (_) {}

    // Upsert the is_self person row.
    const existing = await db`SELECT id FROM persons WHERE child_id = ${childId} AND is_self = TRUE LIMIT 1`;
    let personId;
    if (existing.length) {
      personId = existing[0].id;
      await db`
        UPDATE persons
           SET display_name = ${name},
               given_name = COALESCE(NULLIF(${name}, ''), given_name),
               birth_date = ${birthDate},
               updated_at = NOW()
         WHERE id = ${personId}`;
    } else {
      const inserted = await db`
        INSERT INTO persons (child_id, display_name, given_name, relationship, is_self, birth_date)
        VALUES (${childId}, ${name}, ${name}, 'self', TRUE, ${birthDate})
        RETURNING id`;
      personId = inserted[0].id;
    }

    // Seed child_settings.autoTeach with the picked tier but disabled.
    const csRow = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const settings = (csRow && csRow.settings) || {};
    settings.autoTeach = {
      enabled: false,
      cadence: 'conservative',
      tier,
      dailyGameAt: '15:30',
      cooldownMin: 30,
      batchSize: 4,
    };
    await db`
      INSERT INTO child_settings (child_id, settings, updated_at)
      VALUES (${childId}, ${settings}::jsonb, NOW())
      ON CONFLICT (child_id) DO UPDATE SET settings = ${settings}::jsonb, updated_at = NOW()`;

    await setStep(db, Number(auth.user.uid), nextStep('child'),
                  { childName: name, birthDate, tier });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, step: nextStep('child'), childId, personId: Number(personId) });
  } catch (err) {
    res.status(500).json({ error: 'child step failed', detail: String(err.message || err) });
  }
}
