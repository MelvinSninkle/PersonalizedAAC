# Emergency Beacon — the lost-child mode

> **DARK-LAUNCHED (admin only).** While the owner field-tests it on his own
> child's device, beacon control is admin-only: the dashboard panel is
> hidden for non-admins (`admin-access-only`) and the server rejects
> non-admin control ops (`BEACON_PUBLIC = false` in `api/beacon.js`). To
> ship to families: flip `BEACON_PUBLIC` to `true`, remove the
> `admin-access-only` hiding from the panel in parent.html, and rename its
> section label — the parent gate is already written and waiting.

What it is: a parent-activated mode where the child's device intermittently
speaks a caretaker broadcast in the board's voice ("Please pay attention. The
person holding this device is a vulnerable person…"), flashes a screen of the
child's family photos titled in the family's language ("This is My Family" /
"This is a Phone Number to Call my Family") with the emergency number shown
huge and spoken aloud, and paces itself to preserve the battery. **Never
paywalled** — enforced by invariant F1.

## Setup (do this at onboarding, not in an emergency)

Two ways in — both land on the same panel:

- Parent dashboard → **Emergency beacon** panel (a red nag shows until done).
- From the board itself (existing accounts that never saw an onboarding ask):
  board ⚙ Display Settings → Admin tools → **Set up Emergency Beacon** —
  opens that child's dashboard scrolled to the panel. Admin-only while
  dark-launched; when the beacon graduates this becomes a parent-visible row.

1. Enter the emergency phone number — this is what a rescuer sees and hears.
2. Pick announcement languages. The **family's language always leads**; add
   community languages for where you live (English is sensible almost
   everywhere in the US).
3. Save — the voice clips are synthesized NOW in the board's voice and cached
   on the device at its next sync. **The beacon runs fully offline once
   activated; activation itself is the only step that needs the device to be
   online.**
4. Run the 20-second drill so the family has seen it once on a calm day.
5. Strongly recommend the parent sets the quick-unlock PIN on the device
   (board → Display settings): it is the only way to stop the beacon ON the
   device while it's offline.

## Safe zones (geofence auto-activation)

Same panel: stand where the zone should be (usually home) and tap **Add a
zone here**, pick a radius, then **Arm** the fence and Save. When armed, the
tablet watches its own GPS — the check runs ON the device, so it works with
no internet, which is exactly the gap remote activation can't cover.

- On exit the response is **staged**: the parents are alerted (dashboard +
  push where configured) and a countdown runs on the device (default 10
  minutes; configurable down to instant). **Re-entering the zone cancels
  it.** A caregiver can cancel on the device with the PIN/password.
- Against GPS jitter: a fix only counts as "out" past the radius by
  75m-or-accuracy, an exit needs several consecutive fixes over two minutes,
  and bad fixes (>150m accuracy) are ignored.
- **Arm it for the risky hours, not always** — children leave home with
  their parents every day; an always-armed fence cries wolf.
- Monitoring health is visible on the dashboard ("fence armed · device
  reports: inside"). If it says **no-permission**, the tablet never granted
  location — open the board there and allow it.
- Web reality: the board only watches while it is open and on-screen. There
  is no background geolocation on the web; the native ports get true
  background region monitoring (and will ask for location at setup).

## In an emergency

0. **Call 911 first.** The beacon does not contact emergency services and is
   not a substitute for doing so — this disclosure is shown at setup and in
   the activation dialog, and support must repeat it any time it comes up.
1. Parent dashboard → 🔴 **Activate Emergency Beacon** → type `CONFIRM`.
2. Online device: starts within seconds (the live channel the listening
   remote uses). Offline device: starts the moment it reconnects.
3. The dashboard shows live status while active: battery %, charging, last
   seen, and (when the device grants it) a last-known-location map link.
   Refresh cadence is ~2 minutes from the device.
4. The board stays USABLE between announcements — the beacon recedes to a
   red banner so the child keeps their voice.

## How the battery pacing works

Base cadence by battery (charging 30s / >50% 45s / >25% 2min / >10% 5min /
below 10min), then stretched further whenever the device's MEASURED drain
projects it dying before the 12-hour survival target. Any touch on the
screen triggers an immediate announcement regardless of schedule — quiet
patience, instant response to a human. Web boards read battery on Chromium
(Fire/Android tablets, desktop Chrome); where unreadable the cadence is a
steady conservative 2 minutes.

## Stopping it

- Parent dashboard → Deactivate (anytime), or
- On the device: ✕ Caregiver stop → parent quick PIN (works offline) or the
  account password (online). A wrong entry does nothing — the child cannot
  stop it. An on-device stop holds until the parent explicitly re-activates.

## Limits to be honest about

- Activation cannot reach a device with no connectivity; it arms on reconnect.
- Web boards can only request location permission at activation time (the
  browser prompt appears on the device); the native ports will request it at
  setup, which is one reason the native beacon port leads the parity queue.
- Device volume: the web board cannot force the hardware volume up. Tell
  families to keep the tablet's volume on.
- iOS/Android native apps do not have the beacon yet — see
  native-parity-backlog.md 2E. Until then the beacon is web-board only.
