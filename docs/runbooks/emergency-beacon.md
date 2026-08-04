# Emergency Beacon — the lost-child mode

What it is: a parent-activated mode where the child's device intermittently
speaks a caretaker broadcast in the board's voice ("Please pay attention. The
person holding this device is a vulnerable person…"), flashes a screen of the
child's family photos titled in the family's language ("This is My Family" /
"This is a Phone Number to Call my Family") with the emergency number shown
huge and spoken aloud, and paces itself to preserve the battery. **Never
paywalled** — enforced by invariant F1.

## Setup (do this at onboarding, not in an emergency)

Parent dashboard → **Emergency beacon** panel (a red nag shows until done):

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

## In an emergency

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
