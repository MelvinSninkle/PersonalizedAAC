// /api/admin/lab?action=synonyms  (admin only)
//
// READ-ONLY view of the listening-mode language engine that lives in code:
// the synonym sets ("hi"/"hey" land on the "hello" tile) and the irregular
// inflection map ("go" → went/gone). There is deliberately no write path —
// these ship with the deploy exactly like the taxonomy seed's grammar rules,
// so editing them is a code change in api/_lib/word-match.js (every board
// picks the edit up on its next sync, no DB migration). One-off variants for
// a single word stay in the taxonomy row's match terms field, same as ever.
//
//   GET → { public, sets, irregular, source, note }
import { requireAdmin } from '../_lib/admin.js';
import { SYNONYM_SETS, IRREGULAR, SYNONYMS_PUBLIC } from '../_lib/word-match.js';

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    public: SYNONYMS_PUBLIC,
    sets: SYNONYM_SETS,
    irregular: IRREGULAR,
    source: 'api/_lib/word-match.js',
    note: 'Read-only. Edit the sets in api/_lib/word-match.js (ships with the '
      + 'deploy; boards pick changes up on next sync). One-off variants for a '
      + 'single word belong in that taxonomy row’s match terms field.',
  });
}
