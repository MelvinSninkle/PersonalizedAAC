// GET /api/relationships — the ordered family-relationship picker options
// (high-use first), plus the side + pronoun option lists. Source of truth for
// any people picker (onboarding, people-management). See docs/people-data-model.md.
import { checkAuth } from './_lib/auth.js';
import { RELATIONSHIPS, SIDES, PRONOUNS } from './_lib/relationships.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.status(200).json({ relationships: RELATIONSHIPS, sides: SIDES, pronouns: PRONOUNS });
}
