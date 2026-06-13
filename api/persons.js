// People identities CRUD (docs/people-data-model.md). Photo-based creation still
// flows through /api/onboard-subject (stylize + tile + voice + person); this
// endpoint is for listing and for editing the structured fields without a photo.
//
//   GET    /api/persons?childId=            → { persons: [...] }
//   POST   /api/persons   (JSON body)       → create/update a person; the linked
//          { id?, childId, displayName, givenName, relationship, side, pronoun,
//            birthOrder, isSelf }              People tile's label follows display_name.
//   DELETE /api/persons?id=&childId=         → remove the person row (tile is left as-is).
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild, isParentOf } from './_lib/access.js';
import { isValidRelationship, relationshipNeedsSide } from './_lib/relationships.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const db = sql();

  try {
    if (req.method === 'GET') {
      const childId = String((req.query && req.query.childId) || '').slice(0, 64);
      if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
      if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
      const persons = await db`
        SELECT p.id, p.child_id, p.display_name, p.given_name, p.relationship, p.side, p.pronoun,
               p.birth_order, p.birth_date, p.is_self, p.reference_key, p.pronunciation,
               (SELECT i.id FROM items i WHERE i.person_id = p.id LIMIT 1) AS item_id
        FROM persons p
        WHERE p.child_id = ${childId}
        ORDER BY p.is_self DESC, p.relationship, p.birth_order NULLS LAST, lower(p.display_name)`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ persons });
      return;
    }

    if (req.method === 'POST') {
      const b = (typeof req.body === 'object' && req.body) || {};
      const childId = String(b.childId || '').slice(0, 64);
      const displayName = String(b.displayName || '').slice(0, 200).trim();
      if (!childId || !displayName) { res.status(400).json({ error: 'childId and displayName required' }); return; }
      if (auth.user.role !== 'admin' && !(await isParentOf(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
      const relationship = isValidRelationship(b.relationship) ? b.relationship : 'other';
      const side = (relationshipNeedsSide(relationship) && (b.side === 'maternal' || b.side === 'paternal')) ? b.side : null;
      const pronoun = (b.pronoun === 'she' || b.pronoun === 'he' || b.pronoun === 'they') ? b.pronoun : null;
      const birthOrder = (Number.isFinite(+b.birthOrder) && +b.birthOrder > 0) ? Math.floor(+b.birthOrder) : null;
      const givenName = String(b.givenName || '').slice(0, 120).trim() || null;
      const isSelf = !!b.isSelf || relationship === 'self';
      // YYYY-MM-DD only; only the is_self row meaningfully carries this (drives
      // the board's age filter), but we accept it on any row so parents can
      // record sibling birth dates too.
      const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.birthDate || '')) ? String(b.birthDate) : null;

      let personId = b.id ? Number(b.id) : null;
      if (personId) {
        await db`UPDATE persons SET display_name=${displayName}, given_name=${givenName}, relationship=${relationship},
          side=${side}, pronoun=${pronoun}, birth_order=${birthOrder}, is_self=${isSelf},
          birth_date = COALESCE(${birthDate}, birth_date), updated_at=NOW()
          WHERE id=${personId} AND child_id=${childId}`;
      } else {
        const ex = await db`SELECT id FROM persons WHERE child_id=${childId} AND lower(display_name)=lower(${displayName}) LIMIT 1`;
        if (ex.length) {
          personId = ex[0].id;
          await db`UPDATE persons SET given_name=${givenName}, relationship=${relationship}, side=${side},
            pronoun=${pronoun}, birth_order=${birthOrder}, is_self=${isSelf},
            birth_date = COALESCE(${birthDate}, birth_date), updated_at=NOW() WHERE id=${personId}`;
        } else {
          const p = await db`INSERT INTO persons (child_id, display_name, given_name, relationship, side, pronoun, birth_order, is_self, birth_date)
            VALUES (${childId}, ${displayName}, ${givenName}, ${relationship}, ${side}, ${pronoun}, ${birthOrder}, ${isSelf}, ${birthDate}) RETURNING id`;
          personId = p[0].id;
        }
      }
      // Keep the linked People tile's label in step with the display name.
      await db`UPDATE items SET label=${displayName}, updated_at=NOW() WHERE person_id=${personId} AND child_id=${childId}`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, id: Number(personId) });
      return;
    }

    if (req.method === 'DELETE') {
      const id = Number((req.query && req.query.id) || 0);
      if (!id) { res.status(400).json({ error: 'id required' }); return; }
      const rows = await db`SELECT child_id FROM persons WHERE id = ${id} LIMIT 1`;
      if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
      const childId = rows[0].child_id;
      if (auth.user.role !== 'admin' && !(await isParentOf(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
      await db`UPDATE items SET person_id = NULL WHERE person_id = ${id} AND child_id = ${childId}`;
      await db`DELETE FROM persons WHERE id = ${id} AND child_id = ${childId}`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: 'Persons op failed', detail: String(err.message || err) });
  }
}
