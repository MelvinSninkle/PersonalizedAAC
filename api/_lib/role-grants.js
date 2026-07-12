// Pre-authorized signup roles (role_grants, written by the admin Reports
// page). Applied once, at account creation, then consumed. 'admin' is never
// applied from here no matter what the table contains — defense in depth
// against a poisoned row.
const APPLYABLE = new Set(['therapist', 'school_team', 'language_tester']);

export async function applyRoleGrant(db, user) {
  if (!user || !user.email) return user;
  try {
    const g = (await db`SELECT role FROM role_grants WHERE email = ${String(user.email).toLowerCase()} LIMIT 1`)[0];
    if (!g || !APPLYABLE.has(g.role)) return user;
    await db`UPDATE users SET role = ${g.role} WHERE id = ${user.id} AND role <> 'admin'`;
    await db`DELETE FROM role_grants WHERE email = ${String(user.email).toLowerCase()}`;
    return { ...user, role: g.role };
  } catch (_) { return user; }   // table may not exist yet — grants are best-effort
}
