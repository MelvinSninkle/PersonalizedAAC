// /api/admin/lab?action=role  (admin only)
//
// Grant/revoke limited roles by account email. Exists so feature-flag roles
// (today: language_tester, which unlocks the board-language picker and
// non-English onboarding) can be handed out without touching the database.
// 'admin' is deliberately NOT grantable here.
//
//   GET  → { testers: [accounts with a non-parent role] }
//   POST { email, role } → set role ('parent' | 'therapist' | 'school_team'
//                          | 'language_tester')
import { requireAdmin } from '../_lib/admin.js';
import { sql } from '../_lib/db.js';

export const config = { maxDuration: 30 };
const GRANTABLE = new Set(['parent', 'therapist', 'school_team', 'language_tester']);

export default async function handler(req, res) {
  const gate = await requireAdmin(req, res);
  if (!gate.ok) return;
  const db = sql();
  try {
    if (req.method === 'GET') {
      const rows = await db`SELECT email, role, child_slug FROM users
                            WHERE role NOT IN ('parent', 'admin') ORDER BY role, email LIMIT 200`;
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, special: rows });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = (typeof req.body === 'object' && req.body) || {};
    const email = String(b.email || '').trim().toLowerCase();
    const role = String(b.role || '').trim();
    if (!email || !GRANTABLE.has(role)) { res.status(400).json({ error: `email + role (${[...GRANTABLE].join('|')}) required` }); return; }
    const u = (await db`SELECT id, role FROM users WHERE lower(email) = ${email} LIMIT 1`)[0];
    if (!u) { res.status(404).json({ error: 'no account with that email' }); return; }
    if (u.role === 'admin') { res.status(400).json({ error: 'refusing to change an admin account' }); return; }
    await db`UPDATE users SET role = ${role} WHERE id = ${u.id}`;
    res.status(200).json({ ok: true, email, role });
  } catch (err) {
    res.status(500).json({ error: 'role failed', detail: String(err.message || err) });
  }
}
