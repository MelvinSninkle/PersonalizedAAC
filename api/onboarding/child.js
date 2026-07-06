// POST /api/onboarding/child  { name, birthDate, tier }
//
// Step 2: the child's name + birth date + attention tier. Creates (or
// updates) the persons.is_self row for the slug, seeds child_settings.autoTeach
// to the chosen tier (still disabled — parent opts in later), and advances
// the onboarding step.
import { checkAuth } from '../_lib/auth.js';
import { isParentOf } from '../_lib/access.js';
import { sql } from '../_lib/db.js';
import { ensureProgress, nextStep, setStep, TIER_LABELS, LANGUAGE_LABELS } from '../_lib/onboarding.js';
import { isSelectableVoice } from '../_lib/voices.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const name = String(b.name || '').slice(0, 80).trim();
  const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.birthDate || '')) ? String(b.birthDate) : null;
  const tier = TIER_LABELS.has(b.tier) ? b.tier : 'under3';
  const language = LANGUAGE_LABELS.has(b.language) ? b.language : 'en';
  // ElevenLabs voice ids are ~20-char alphanumerics; accept and store the
  // parent's pick so every tile's generated audio speaks in that voice. Gate it
  // to the curated catalog — only an admin may assign the reserved default voice.
  const rawVoice = typeof b.voiceId === 'string' && /^[A-Za-z0-9]{8,40}$/.test(b.voiceId.trim())
    ? b.voiceId.trim() : null;
  const voiceId = (rawVoice && isSelectableVoice(rawVoice, { isAdmin: auth.user.role === 'admin' })) ? rawVoice : null;
  // The chosen art style (a style_guides id) becomes the child's HOUSE STYLE —
  // every tile generated later attaches this exemplar so the board stays
  // visually consistent.
  const styleGuideId = Number.isFinite(Number(b.styleGuideId)) && Number(b.styleGuideId) > 0
    ? Number(b.styleGuideId) : null;
  // Favorite color → the child's banner color everywhere (§1). Contrast is
  // decided HERE by WCAG relative luminance — one rule for every client, and
  // arbitrary picks stay readable (dark banner → white text, light → ink).
  const favoriteColor = /^#[0-9a-fA-F]{6}$/.test(String(b.favoriteColor || '').trim())
    ? String(b.favoriteColor).trim().toLowerCase() : null;
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

    // Seed child_settings.autoTeach with the picked tier but disabled, AND
    // record the family's chosen language at the top level so other surfaces
    // (TTS, taxonomy filtering when translations land) can read it.
    const csRow = (await db`SELECT settings FROM child_settings WHERE child_id = ${childId} LIMIT 1`)[0];
    const settings = (csRow && csRow.settings) || {};
    settings.language = language;
    if (voiceId) settings.voiceId = voiceId;
    if (styleGuideId) settings.styleGuideId = styleGuideId;
    if (favoriteColor) {
      // WCAG relative luminance (sRGB linearized) — not a hardcoded color list.
      const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      const L = 0.2126 * lin(parseInt(favoriteColor.slice(1, 3), 16))
              + 0.7152 * lin(parseInt(favoriteColor.slice(3, 5), 16))
              + 0.0722 * lin(parseInt(favoriteColor.slice(5, 7), 16));
      settings.kidDisplay = Object.assign({}, settings.kidDisplay || {}, {
        colorHeaderBg: favoriteColor,
        colorHeaderText: L > 0.45 ? '#1f2937' : '#ffffff',
      });
    }
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
                  { childName: name, birthDate, tier, language, voiceId, styleGuideId });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, step: nextStep('child'), childId, personId: Number(personId) });
  } catch (err) {
    res.status(500).json({ error: 'child step failed', detail: String(err.message || err) });
  }
}
