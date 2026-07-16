// POST /api/layout-offer { childId, offerId, action: 'accept' | 'dismiss' }
//
// The FAMILY's answer to a layout offer (admin curated a new default board
// arrangement and chose "ask families" instead of applying — see
// _lab-publish.js). Accepting applies the same layout push the admin would
// have run, with the parent's approval standing in for the overwrite
// override; declining marks the offer dismissed so the popup never returns
// for it. Self-gating: only someone with access to the child may answer.
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild } from './_lib/access.js';
import { pushLayout } from './admin/_lab-publish.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = String(b.childId || '').slice(0, 64);
  const offerId = Number(b.offerId);
  const action = b.action === 'accept' ? 'accept' : b.action === 'dismiss' ? 'dismiss' : null;
  if (!childId || !Number.isFinite(offerId) || !action) {
    res.status(400).json({ error: 'childId, offerId, and action (accept|dismiss) required' }); return;
  }

  try {
    const db = sql();
    if (!(await canAccessChild(auth.user, childId, db))) {
      res.status(403).json({ error: 'No access to this child' }); return;
    }
    const offer = (await db`SELECT id, status FROM layout_offers
                            WHERE id = ${offerId} AND child_id = ${childId} LIMIT 1`)[0];
    if (!offer) { res.status(404).json({ error: 'offer not found' }); return; }
    if (offer.status !== 'pending') { res.status(200).json({ ok: true, already: offer.status }); return; }

    if (action === 'accept') {
      // Parent consent = the override: apply even to a family-arranged board.
      const r = await pushLayout(db, childId, { overwriteCustomized: true });
      await db`UPDATE layout_offers SET status = 'accepted', responded_at = NOW() WHERE id = ${offerId}`;
      res.status(200).json({ ok: true, applied: r });
      return;
    }
    await db`UPDATE layout_offers SET status = 'dismissed', responded_at = NOW() WHERE id = ${offerId}`;
    res.status(200).json({ ok: true, dismissed: true });
  } catch (err) {
    res.status(500).json({ error: 'layout-offer failed', detail: String(err.message || err) });
  }
}
