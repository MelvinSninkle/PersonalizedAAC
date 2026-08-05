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

// DARK LAUNCH: while the owner field-tests the beacon on his own child's
// device, control ops are ADMIN-ONLY. Flip this to true (and un-hide the
// parent.html panel) to ship it to every family — the parent gate below is
// already written and waiting.
const BEACON_PUBLIC = false;

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
      const st = (await db`SELECT battery, charging, lat, lng, accuracy, last_seen, activated_by,
                                  staged_at, staged_zone, zone_state
                           FROM beacon_state WHERE child_id = ${childId}`)[0] || {};
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ok: true, beacon, status: {
        battery: st.battery ?? null, charging: st.charging ?? null,
        lat: st.lat ?? null, lng: st.lng ?? null, accuracy: st.accuracy ?? null,
        lastSeen: st.last_seen || null, activatedBy: st.activated_by || null,
        stagedAt: st.staged_at || null, stagedZone: st.staged_zone || null,
        zoneState: st.zone_state || null,
      } });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    if (b.op === 'zone-exit') {
      // The DEVICE detected a safe-zone exit and is staging: alert the
      // parents now (dashboard + push), independent of the countdown. Roster
      // access is enough — the board device is the caller.
      const zone = String(b.zone || 'safe zone').slice(0, 40);
      await db`UPDATE beacon_state SET staged_at = now(), staged_zone = ${zone}, updated_at = now()
               WHERE child_id = ${childId}`;
      try {
        const { apnsConfigured, sendToTokens } = await import('./_lib/apns.js');
        if (apnsConfigured()) {
          const toks = await db`SELECT token FROM push_tokens WHERE child_id = ${childId} AND role IN ('parent','admin')`;
          if (toks.length) {
            const mins = Number(b.alertMinutes);
            await sendToTokens(toks.map((t) => t.token), {
              title: '⚠️ Safe-zone alert',
              body: `The device left “${zone}”. ` + (Number.isFinite(mins) && mins > 0
                ? `The Emergency Beacon starts in ${mins} min unless you stop it from the dashboard.`
                : 'The Emergency Beacon is starting now.'),
              data: { kind: 'beacon-zone-exit' },
            });
          }
        }
      } catch (_) { /* push is best-effort; staged_at is the record */ }
      res.status(200).json({ ok: true });
      return;
    }

    if (b.op === 'zone-clear') {
      // Re-entered the zone (or a caregiver cancelled on the device) before
      // the countdown fired.
      await db`UPDATE beacon_state SET staged_at = NULL, staged_zone = NULL, updated_at = now()
               WHERE child_id = ${childId}`;
      res.status(200).json({ ok: true });
      return;
    }

    if (b.op === 'zone-fire') {
      // The device's countdown expired and it lit the beacon LOCALLY —
      // raise the server state to match so the dashboard shows active and
      // pings aren't reconciled back off. Guarded: only honored when the
      // fence is armed and an exit was actually staged recently, so a
      // roster session can't use this as an unguarded activate.
      const st = (await db`SELECT armed, staged_at FROM beacon_state WHERE child_id = ${childId}`)[0];
      const stagedRecently = st && st.staged_at && (Date.now() - new Date(st.staged_at).getTime()) < 2 * 3600_000;
      if (!st || !st.armed || !stagedRecently) { res.status(409).json({ error: 'no armed staged exit to fire from' }); return; }
      await db`UPDATE beacon_state SET active = TRUE,
               activated_at = COALESCE(activated_at, now()),
               activated_by = COALESCE(activated_by, 'geofence:' || COALESCE(staged_zone, 'zone')),
               updated_at = now()
               WHERE child_id = ${childId}`;
      res.status(200).json({ ok: true, active: true });
      return;
    }

    if (b.op === 'ping') {
      // The board device checking in. Roster access is enough (the kid device
      // authenticates as a roster session); parents' dashboards read it back.
      const battery = Number.isFinite(Number(b.battery)) ? Math.max(0, Math.min(100, Math.round(Number(b.battery)))) : null;
      const lat = Number.isFinite(Number(b.lat)) ? Number(b.lat) : null;
      const lng = Number.isFinite(Number(b.lng)) ? Number(b.lng) : null;
      const acc = Number.isFinite(Number(b.accuracy)) ? Number(b.accuracy) : null;
      const zoneState = typeof b.zoneState === 'string' ? b.zoneState.slice(0, 24) : null;
      await db`
        INSERT INTO beacon_state (child_id, battery, charging, lat, lng, accuracy, zone_state, last_seen, updated_at)
        VALUES (${childId}, ${battery}, ${b.charging === true}, ${lat}, ${lng}, ${acc}, ${zoneState}, now(), now())
        ON CONFLICT (child_id) DO UPDATE SET
          battery = ${battery}, charging = ${b.charging === true},
          lat = COALESCE(${lat}, beacon_state.lat),
          lng = COALESCE(${lng}, beacon_state.lng),
          accuracy = COALESCE(${acc}, beacon_state.accuracy),
          zone_state = COALESCE(${zoneState}, beacon_state.zone_state),
          last_seen = now(), updated_at = now()`;
      const st = (await db`SELECT active FROM beacon_state WHERE child_id = ${childId}`)[0];
      res.status(200).json({ ok: true, active: !!(st && st.active) });
      return;
    }

    // Everything below changes the beacon itself: parents (or admin) only —
    // a therapist or school login must not be able to trigger or silence it.
    // While dark-launched (BEACON_PUBLIC=false) the parent path is off and
    // only the admin can control any beacon.
    const isParent = auth.user.role === 'admin'
      || (BEACON_PUBLIC && await isParentOf(auth.user, childId, db));
    if (!isParent) {
      res.status(403).json({ error: BEACON_PUBLIC
        ? 'Only a parent can control the beacon'
        : 'The Emergency Beacon is in admin testing and not yet released' });
      return;
    }

    if (b.op === 'config') {
      const phone = String(b.phone || '').replace(/[^\d+() .-]/g, '').trim().slice(0, 24);
      if (phone.replace(/\D/g, '').length < 7) { res.status(400).json({ error: 'Enter a real phone number — it is what a rescuer will call.' }); return; }
      let langs = (Array.isArray(b.langs) ? b.langs : []).filter((l) => BEACON_LANGS.includes(l));
      if (!langs.length) langs = ['en'];
      // Safe zones: ≤5 circles, radius clamped 50m–5km. Zone checking runs
      // on the device from GPS, so an offline device can still self-activate.
      const zones = (Array.isArray(b.zones) ? b.zones : []).slice(0, 5)
        .map((z) => ({
          name: String((z && z.name) || 'Safe zone').slice(0, 40),
          lat: Number(z && z.lat), lng: Number(z && z.lng),
          radius: Math.max(50, Math.min(5000, Math.round(Number(z && z.radius) || 200))),
        }))
        .filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lng)
          && Math.abs(z.lat) <= 90 && Math.abs(z.lng) <= 180);
      const armed = b.armed === true && zones.length > 0;
      const alertMinutes = Math.max(0, Math.min(60, Math.round(Number(b.alertMinutes ?? 10)) || 0));
      await db`
        INSERT INTO beacon_state (child_id, phone, langs, zones, armed, alert_minutes, updated_at)
        VALUES (${childId}, ${phone}, ${JSON.stringify(langs)}, ${JSON.stringify(zones)}, ${armed}, ${alertMinutes}, now())
        ON CONFLICT (child_id) DO UPDATE SET
          phone = ${phone}, langs = ${JSON.stringify(langs)},
          zones = ${JSON.stringify(zones)}, armed = ${armed}, alert_minutes = ${alertMinutes},
          staged_at = CASE WHEN ${armed} THEN beacon_state.staged_at ELSE NULL END,
          staged_zone = CASE WHEN ${armed} THEN beacon_state.staged_zone ELSE NULL END,
          updated_at = now()`;
      const r = await buildBeaconClips(db, childId, { phone, langs });
      // Config changes (arming especially) reach an online board in seconds.
      await pushLiveCmd(db, childId, 'beacon-cfg');
      res.status(200).json({ ok: true, phone, langs, zones, armed, alertMinutes,
        clipsBuilt: r.built, clipsFailed: r.failed,
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
