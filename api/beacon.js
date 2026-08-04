// /api/beacon — the Emergency Beacon (lost-child mode). See _lib/beacon.js
// for the model. NEVER PAYWALLED: this file must not import or consult
// entitlements, tiers, budgets, or charge helpers — a lapsed subscription
// must not silence a lost child's device (surface-audit invariant).
//
//   GET  ?childId=            → full state (config + live status) — roster-gated
//   POST { op:'config', childId, phone, langs[] }   parent saves the number +
//        languages; clips are synthesized NOW so the device is ready offline
//   POST { op:'activate', childId }    parent turns it on (UI requires typing
//        CONFIRM); also pushes a beacon-start command down the fast /api/live
//        channel the board polls every ~2.5s
//   POST { op:'deactivate', childId }  parent turns it off (beacon-stop cmd)
//   POST { op:'drill', childId }       one quiet practice cycle (beacon-drill)
//   POST { op:'ping', childId, battery, charging, lat?, lng?, accuracy? }
//        the BOARD reports in while the beacon is active; response carries
//        { active } so a device that missed the live command reconciles
import { checkAuth } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { canAccessChild, isParentOf } from './_lib/access.js';
import { ensureBeacon, buildBeaconClips, beaconFor, BEACON_LANGS } from './_lib/beacon.js';

export const config = { maxDuration: 120 };   // clip synthesis on save

const CMD_ACTIONS = { activate: 'beacon-start', deactivate: 'beacon-stop', drill: 'beacon-drill' };

async function pushLiveCmd(db, childId, action) {
  // Same shape /api/live writes, so the board's existing applyCmd poll picks
  // beacon commands up within seconds when the device is online.
  const json = JSON.stringify({ action, ts: Date.now() });
  try {
    await db`
      INSERT INTO live_sessions (child_id, cmd, cmd_seq, updated_at)
      VALUES (${childId}, jsonb_set(${json}::jsonb, '{seq}', '1'::jsonb), 1, now())
      ON CONFLICT (child_id) DO UPDATE SET
        cmd_seq = live_sessions.cmd_seq + 1,
        cmd = jsonb_set(${json}::jsonb, '{seq}', to_jsonb(live_sessions.cmd_seq + 1)),
        updated_at = now()`;
  } catch (_) { /* live push is best-effort — durable state is the truth */ }
}

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }
  const db = sql();
  const b = (typeof req.body === 'object' && req.body) || {};
  const childId = String((req.query && req.query.childId) || b.childId || '').slice(0, 64);
  if (!childId) { res.status(400).json({ error: 'childId required' }); return; }
  if (!(await canAccessChild(auth.user, childId, db))) { res.status(403).json({ error: 'Forbidden' }); return; }
  await ensureBeacon(db);

  try {
    if (req.method === 'GET') {
      const beacon = await beaconFor(db, childId);
      const st = (await db`SELECT battery, charging, lat, lng, accuracy, last_seen, activated_by
                           FROM beacon_state WHERE child_id = ${childId}`)[0] || {};
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, beacon, status: {
        battery: st.battery ?? null, charging: st.charging ?? null,
        lat: st.lat ?? null, lng: st.lng ?? null, accuracy: st.accuracy ?? null,
        lastSeen: st.last_seen || null, activatedBy: st.activated_by || null,
      } });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    if (b.op === 'ping') {
      // The board device checking in. Roster access is enough (the kid device
      // authenticates as a roster session); parents' dashboards read it back.
      const battery = Number.isFinite(Number(b.battery)) ? Math.max(0, Math.min(100, Math.round(Number(b.battery)))) : null;
      const lat = Number.isFinite(Number(b.lat)) ? Number(b.lat) : null;
      const lng = Number.isFinite(Number(b.lng)) ? Number(b.lng) : null;
      const acc = Number.isFinite(Number(b.accuracy)) ? Number(b.accuracy) : null;
      await db`
        INSERT INTO beacon_state (child_id, battery, charging, lat, lng, accuracy, last_seen, updated_at)
        VALUES (${childId}, ${battery}, ${b.charging === true}, ${lat}, ${lng}, ${acc}, now(), now())
        ON CONFLICT (child_id) DO UPDATE SET
          battery = ${battery}, charging = ${b.charging === true},
          lat = COALESCE(${lat}, beacon_state.lat),
          lng = COALESCE(${lng}, beacon_state.lng),
          accuracy = COALESCE(${acc}, beacon_state.accuracy),
          last_seen = now(), updated_at = now()`;
      const st = (await db`SELECT active FROM beacon_state WHERE child_id = ${childId}`)[0];
      res.status(200).json({ ok: true, active: !!(st && st.active) });
      return;
    }

    // Everything below changes the beacon itself: parents (or admin) only —
    // a therapist or school login must not be able to trigger or silence it.
    const isParent = auth.user.role === 'admin' || await isParentOf(auth.user, childId, db);
    if (!isParent) { res.status(403).json({ error: 'Only a parent can control the beacon' }); return; }

    if (b.op === 'config') {
      const phone = String(b.phone || '').replace(/[^\d+() .-]/g, '').trim().slice(0, 24);
      if (phone.replace(/\D/g, '').length < 7) { res.status(400).json({ error: 'Enter a real phone number — it is what a rescuer will call.' }); return; }
      let langs = (Array.isArray(b.langs) ? b.langs : []).filter((l) => BEACON_LANGS.includes(l));
      if (!langs.length) langs = ['en'];
      await db`
        INSERT INTO beacon_state (child_id, phone, langs, updated_at)
        VALUES (${childId}, ${phone}, ${JSON.stringify(langs)}, now())
        ON CONFLICT (child_id) DO UPDATE SET
          phone = ${phone}, langs = ${JSON.stringify(langs)}, updated_at = now()`;
      const r = await buildBeaconClips(db, childId, { phone, langs });
      res.status(200).json({ ok: true, phone, langs, clipsBuilt: r.built, clipsFailed: r.failed,
        note: r.failed ? 'Some voice clips failed to render — save again to retry.' :
          'Voice clips are ready and will be cached on the device at its next sync.' });
      return;
    }

    if (b.op === 'activate' || b.op === 'deactivate' || b.op === 'drill') {
      const st = (await db`SELECT phone FROM beacon_state WHERE child_id = ${childId}`)[0];
      if (!st || !st.phone) { res.status(400).json({ error: 'Set the emergency phone number first — the beacon shows and speaks it.' }); return; }
      if (b.op !== 'drill') {
        await db`UPDATE beacon_state SET
          active = ${b.op === 'activate'},
          activated_at = ${b.op === 'activate' ? new Date() : null},
          activated_by = ${b.op === 'activate' ? (auth.user.email || 'parent') : null},
          updated_at = now()
          WHERE child_id = ${childId}`;
      }
      await pushLiveCmd(db, childId, CMD_ACTIONS[b.op]);
      res.status(200).json({ ok: true, op: b.op,
        note: b.op === 'activate'
          ? 'Beacon armed. If the device is online it starts within seconds; if it is offline, it starts the moment it reconnects.'
          : b.op === 'drill' ? 'Drill sent — the board runs one practice cycle and stops itself.' : 'Beacon off.' });
      return;
    }

    res.status(400).json({ error: 'unknown op' });
  } catch (err) {
    res.status(500).json({ error: 'beacon failed', detail: String(err.message || err) });
  }
}
