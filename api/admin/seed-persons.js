// POST /api/admin/seed-persons?childId=<slug>
// Populate the `persons` identities for a child from their existing People
// tiles, and link items.person_id back to each person. Fletcher's exact family
// mapping is built in; other children may pass { mapping: { "<tile label>": {
//   relationship, side, given_name, pronoun, birth_order, is_self } } } in the body.
// Idempotent: re-running updates the same rows. See docs/people-data-model.md.
import { checkAuth } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { isValidRelationship, relationshipNeedsSide } from '../_lib/relationships.js';

// Known family for the pilot child. Keys match their People tile labels (lower-cased).
// Fletcher is the user (is_self); Sawyer is the younger brother (birth_order 2 vs
// Fletcher's 1). Papa Gary = paternal grandfather; Grandma Jane = maternal grandmother.
const FLETCHER_PEOPLE = {
  'fletcher':     { is_self: true, relationship: 'self',          given_name: 'Fletcher', pronoun: 'he',  birth_order: 1 },
  'mama':         { relationship: 'mother',                        pronoun: 'she' },
  'dada':         { relationship: 'father',                        pronoun: 'he' },
  'sawyer':       { relationship: 'brother',     given_name: 'Sawyer', pronoun: 'he',  birth_order: 2 },
  'papa gary':    { relationship: 'grandfather', side: 'paternal', given_name: 'Gary', pronoun: 'he' },
  'grandma jane': { relationship: 'grandmother', side: 'maternal', given_name: 'Jane', pronoun: 'she' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  if (auth.user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }

  const childId = String((req.query && req.query.childId) || 'fletcherpeterson').slice(0, 64);
  const body = (typeof req.body === 'object' && req.body) || {};
  const mapping = childId === 'fletcherpeterson' ? FLETCHER_PEOPLE : (body.mapping || {});

  try {
    const db = sql();
    // Defensive schema (mirrors /api/init) so this works before a fresh init.
    await db`
      CREATE TABLE IF NOT EXISTS persons (
        id BIGSERIAL PRIMARY KEY, child_id TEXT NOT NULL, display_name TEXT NOT NULL,
        given_name TEXT, relationship TEXT NOT NULL DEFAULT 'other', side TEXT, pronoun TEXT,
        birth_order INTEGER, is_self BOOLEAN NOT NULL DEFAULT FALSE, reference_key TEXT,
        voice_key TEXT, pronunciation TEXT, notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await db`ALTER TABLE items ADD COLUMN IF NOT EXISTS person_id BIGINT REFERENCES persons(id)`;

    const people = await db`
      SELECT id, label, image_key, sound_key, person_id
      FROM items WHERE child_id = ${childId} AND section = 'people'`;

    const linked = [], skipped = [];
    for (const [labelKey, spec] of Object.entries(mapping)) {
      const item = people.find(p => String(p.label || '').trim().toLowerCase() === labelKey.toLowerCase());
      if (!item) { skipped.push({ label: labelKey, reason: 'no matching People tile' }); continue; }

      const rel = isValidRelationship(spec.relationship) ? spec.relationship : 'other';
      const side = relationshipNeedsSide(rel) ? (spec.side || null) : null;
      const display = item.label;

      const ex = await db`SELECT id FROM persons WHERE child_id = ${childId} AND lower(display_name) = lower(${display}) LIMIT 1`;
      let personId;
      if (ex.length) {
        personId = ex[0].id;
        await db`
          UPDATE persons SET
            given_name = ${spec.given_name || null}, relationship = ${rel}, side = ${side},
            pronoun = ${spec.pronoun || null}, birth_order = ${spec.birth_order ?? null},
            is_self = ${!!spec.is_self},
            reference_key = COALESCE(${item.image_key || null}, reference_key),
            voice_key = COALESCE(${item.sound_key || null}, voice_key), updated_at = NOW()
          WHERE id = ${personId}`;
      } else {
        const p = await db`
          INSERT INTO persons
            (child_id, display_name, given_name, relationship, side, pronoun, birth_order, is_self, reference_key, voice_key)
          VALUES
            (${childId}, ${display}, ${spec.given_name || null}, ${rel}, ${side}, ${spec.pronoun || null},
             ${spec.birth_order ?? null}, ${!!spec.is_self}, ${item.image_key || null}, ${item.sound_key || null})
          RETURNING id`;
        personId = p[0].id;
      }
      await db`UPDATE items SET person_id = ${personId}, updated_at = NOW() WHERE id = ${item.id}`;
      linked.push({ label: display, relationship: rel, side: side || null, personId: Number(personId) });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, childId, linkedCount: linked.length, linked, skipped });
  } catch (err) {
    res.status(500).json({ error: 'Seed persons failed', detail: String(err.message || err) });
  }
}
