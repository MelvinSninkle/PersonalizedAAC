# Beacon travel modes — design (not yet built)

Planning doc, 2026-08-04. Owner ask: make the safe-zone fence seamless for
normal family car trips, while "if Fletcher was 300 feet from our house I'd
want to know that immediately."

## The trap this design must not fall into

"Moving at vehicle speed ⇒ with an adult ⇒ suppress" is wrong in the one
scenario that matters most: a child taken INTO a vehicle. Speed does not mean
safe. So the rule that governs everything here:

> **Rate of travel never turns monitoring off. It only chooses the response
> tier. No exit is ever silent.**

And its corollary: the correct end-state suppressor is not "vehicle" but
**"a parent is with them"** — which is a different signal (see Phase 2).

## Why in-vehicle means QUIET, not off (owner's insight, 2026-08-04)

The beacon's audience is **bystanders** — the announcement asks a nearby
stranger to help. An abductor is not swayed by it, a moving private car has
no bystanders to hear it, and an alarming device is a device that gets
smashed or thrown out a window — **which destroys the one asset still
working for the family: the tracking.** So in a vehicle the beacon goes
audio-silent BY DESIGN, to protect the breadcrumb trail, while:

- the parents are alerted the moment the vehicle exit is detected,
- breadcrumbs keep flowing (route on the dashboard),
- the SCREEN stays in visual-beacon mode (flashing family/phone screen with
  no sound) — this covers the bus/train case, where bystanders DO exist and
  can see it,
- any human TOUCH restores full audio instantly (a person touching the
  device is a bystander, wherever it is),
- and audio resumes automatically once the device has been out of vehicle
  motion for `resumeMinutes` (default 5) — "they're out of the car, start
  playing again."

This same quiet-while-moving behavior applies to an ALREADY-ACTIVE beacon
that enters sustained vehicle motion (configurable, `vehicleQuiet`, default
on). The beacon is never DOWNGRADED — state stays active, screen stays lit,
tracking continues — only the audio pauses where it can't help and can hurt.

## Two thresholds, not one

Today one hysteresis gate controls both the parent alert and the beacon
staging. Split them:

- **ALERT threshold (know immediately):** the FIRST solid out-fix — good
  accuracy, past the radius by the margin — sends the parent push right
  away, before dwell confirmation: *"Device just left Home — 90m away,
  moving at walking pace."* Pushes are cheap; sirens are not. This is the
  300-feet requirement: no countdown, no dwell, just *knowing*. (Pair with a
  yard-sized zone radius, ~100m, for a family that wants this sensitivity.)
- **BEACON threshold (make noise):** keeps today's jitter hysteresis
  (multiple fixes over two minutes) plus the travel-mode tiering below
  before the device itself starts alarming.

## Travel classification

Web: derive speed from consecutive fixes (displacement / Δt), only when
displacement clearly exceeds the sum of the two fixes' accuracies — two
sloppy fixes can fake 3 m/s. `coords.speed` is used when present. Needs two
fixes ≥30s apart, so classification lags the exit by ~1–2 min; the ALERT
above already fired by then. Native ports: use the platform activity APIs
(CMMotionActivity / ActivityRecognition — direct "automotive | on_foot |
still"), which are both more accurate and nearly free on battery.

Classes: **WALKING** (< ~3 m/s sustained), **VEHICLE** (> ~7 m/s sustained),
**UNKNOWN** (insufficient data → treated as WALKING; fail toward caution).

## The state machine

```
INSIDE ──exit──▶ classify
  WALKING/UNKNOWN ─▶ WANDER: instant alert push; SHORT countdown
                     (walkMinutes, default 2, min 0) ─▶ BEACON
  VEHICLE ─────────▶ TRAVELING: info-tier push ("left Home in a vehicle");
                     NO countdown; breadcrumb pings every ~60–90s
                     (dashboard shows the route so far)
TRAVELING ──speed < 1 m/s for ~5 min, outside all zones──▶ STOPPED:
                     push "device stopped near <map link>" + standard
                     countdown (alertMinutes) unless a suppressor holds
any state ──re-enter a zone──▶ INSIDE (everything clears)
BEACON, once lit, is NEVER downgraded by travel mode. Only the existing
stop paths (parent, PIN, re-activation rules) end it.
```

Why TRAVELING→STOPPED matters: it converts "suppressed because driving"
into "re-armed the moment the drive ends somewhere unknown." A normal
errand ends inside a store with a parent — they get one push and tap
"all good" (suppresses for N hours). An abduction ends somewhere a parent
doesn't expect — the countdown starts there.

## Suppressors (what makes it seamless)

1. **Together mode (Phase 1, ships with current web stack):** one tap on
   the parent dashboard/phone — "we're out together" — suppresses WANDER
   and STOPPED escalation for a chosen window (2h/4h/8h) or until the next
   zone re-entry. Manual, but zero-infrastructure and completely honest.
2. **"All good" on any alert push/dashboard banner:** per-event suppression
   for N hours, so one grocery run is one tap, not a disarm.
3. **Parent-phone proximity (Phase 2, native parent app):** the parent's
   phone reports coarse location (significant-change API, ~free on
   battery); server-side co-location within ~200m = with-a-parent =
   everything quiet automatically. This is the true seamless: it suppresses
   BECAUSE the parent is there, not because a vehicle is moving — so a
   child alone in any vehicle is never suppressed. Requires explicit
   parent opt-in; child-device location is already beacon-scoped.

## Config surface (added to the existing beacon config)

Everything configurable, everything with a sane default — parents differ
and the settings screen must explain each knob in plain words:

- `walkMinutes` (default 2, 0 = instant) — countdown for a walking exit.
- `alertMinutes` (existing, default 10) — countdown after a vehicle STOP.
- `resumeMinutes` (default 5) — how long out of vehicle motion before audio
  resumes/starts.
- `vehicleQuiet` (default on) — pause announcements during sustained
  vehicle motion (visual beacon + touch-restore always stay on).
- `togetherUntil` (server-side timestamp) — Together mode.
- Per the trap rule: there is deliberately NO "suppress vehicle exits
  entirely" option, and no option to stop parent alerts on exit.

## Disclosures & consent (required, part of Phase 1)

The setup flow must present — and record acknowledgment of (timestamp on
the beacon config) — plain-language disclosures:

- **This does not call 911.** The beacon never contacts emergency services,
  and it is not a substitute for calling them. If a child is missing, call
  911 first, then activate the beacon.
- It only works while the device is on, charged, and (for web boards) open
  on screen; location and alerts need the device to reach the internet;
  GPS accuracy varies.
- Location is collected only while the fence is armed or the beacon is
  active, is visible only to the child's parents, and is not shared with
  anyone else.
- The same "call 911 first" line appears in the activation CONFIRM dialog
  itself — the moment of activation is the moment the family most needs
  the reminder. (Shipped ahead of this design: the live parent panel and
  activation prompt already carry it.)

## Battery notes

Fast sampling only near/outside the boundary (as today); TRAVELING samples
at 60–90s for breadcrumbs (a vehicle drains chargers, not batteries, in
most family cars — and the trail is worth it); WANDER samples fast because
minutes matter. Native activity APIs make classification ~free.

## Phasing

- **Phase 1 (web + server, current stack):** two-threshold alerting, speed
  derivation + WANDER/TRAVELING/STOPPED tiers, Together mode, "all good"
  actions, breadcrumb pings + dashboard trail.
- **Phase 2 (native):** activity-API classification, true background
  monitoring, parent-phone proximity pairing — folded into the native
  beacon port that already leads the parity queue.

## Honest limits to carry into the UI copy

- Web classification needs ~2 fixes: a vehicle exit may get one WANDER-tier
  alert before reclassifying quiet. Acceptable: over-alerting beats
  under-alerting, and the push says "moving at walking pace" only when it
  actually measured that.
- 300-feet-immediately is bounded by GPS fix cadence: realistically
  ~30–90s from crossing the line to the push, with a 100m zone. Native
  background monitoring tightens this.
- None of this works with the web board closed/asleep (unchanged).
