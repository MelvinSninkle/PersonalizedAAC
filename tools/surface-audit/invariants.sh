#!/usr/bin/env bash
# Mechanical surface-audit invariants (the grep-able subset of
# .claude/skills/surface-audit/SKILL.md) as CI checks. Each failure names the
# skill section that explains WHY the invariant exists. Run from repo root.
set -u
cd "$(dirname "$0")/../.."
FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
pass() { echo "PASS: $1"; }

# ── E2: nothing writes translations into labels ──────────────────────────────
# The four known-good label writers are parent/admin edit paths. A NEW hit
# must be reviewed against skill section E2 before whitelisting here.
HITS=$(grep -rln "UPDATE items SET label\|UPDATE categories SET label" api | sort)
WANT="api/_lib/seed-board.js
api/_lib/tile-jobs.js
api/admin/_lab-publish-tile.js
api/persons.js"
if [ "$HITS" == "$WANT" ]; then pass "E2 label-write whitelist unchanged"; else
  fail "E2 label writers changed — diff vs whitelist:"; diff <(echo "$WANT") <(echo "$HITS") | sed 's/^/  /'; fi

# ── B3: TTS cache key sites stay in lockstep ─────────────────────────────────
# The sha256 cache key is built in three places that MUST agree (tts.js,
# synthesizeVoice, publish pushSounds). Count the construction sites.
N=$(grep -rl "createHash('sha256')" api/tts.js api/_lib/onboarding-render.js api/admin/_lab-publish.js 2>/dev/null | wc -l)
if [ "$N" -eq 3 ]; then pass "B3 three TTS cache-key sites present"; else
  fail "B3 expected 3 TTS cache-key sites, found $N — read skill B3 before touching"; fi

# ── A1: media ownership union covers every child-media table ────────────────
for T in items categories persons reference_images pending_tiles item_image_history tile_jobs; do
  grep -q "FROM $T WHERE" api/media.js || fail "A1 media.js ownership union lost table: $T"
done
grep -q "FROM tile_jobs WHERE" api/media.js && pass "A1 media ownership union intact"

# ── A-PUBLIC: exactly the four public media prefixes ─────────────────────────
P=$(grep -o "'[a-z-]*/'" api/media.js | grep -c "defaults/\|demo-audio/")
if [ "$P" -eq 4 ]; then pass "A-PUBLIC exactly 4 public prefixes"; else
  fail "A-PUBLIC public prefix count changed ($P) — audit skill section A-PUBLIC"; fi
grep -q "demo-audio/" api/media.js || fail "A-PUBLIC demo-audio prefix missing"

# ── E6: access-experiment keys stay admin-gated ──────────────────────────────
grep -q "ACCESS_KEYS = \['navMode', 'sentenceBuilder', 'sentenceIdleMin', 'sentenceLift', 'listenRepeatNav'\]" api/child-settings.js \
  && pass "E6 access keys admin-gated" \
  || fail "E6 ACCESS_KEYS gate changed in child-settings.js"

# ── E6b: easyUnlock enable stays password-guarded in both UIs ────────────────
# The touch/safety keys are deliberately parent-writable (NOT in ACCESS_KEYS);
# the invariant is that ENABLING password-free unlock re-verifies the account
# password. If either confirm handler or its /api/auth/login call vanishes,
# the warning flow was probably gutted.
for f in app.html parent.html; do
  if grep -q "unlock-yes" "$f" && grep -q "/api/auth/login" "$f"; then
    pass "E6b easyUnlock password-confirm present in $f"
  else
    fail "E6b easyUnlock enable flow missing password verify in $f"
  fi
done

# ── C6b: revert-image only restores keys from the tile's own history ─────────
grep -q "item_image_history" api/items.js \
  && pass "C6b revert-image checks item_image_history" \
  || fail "C6b items.js revert-image lost its history-containment check"

# ── E1: board language stays tester-gated ────────────────────────────────────
grep -q "language_tester" api/child-settings.js && pass "E1 language tester gate present" \
  || fail "E1 language gate missing from child-settings.js"

# ── D: every admin lab handler self-gates ────────────────────────────────────
MISSING=$(grep -rLn "requireAdmin" api/admin/_lab-*.js | head -5)
if [ -z "$MISSING" ]; then pass "D all _lab-* handlers requireAdmin"; else
  fail "D lab handlers missing requireAdmin:"; echo "$MISSING" | sed 's/^/  /'; fi

# ── C8: no per-image style/model picking on any family surface ───────────────
# Every image add asks keep-vs-restyle to the SAVED board style; the only
# place to change a style is the dashboard's Art style panel. These are the
# pickers we ripped out — a reappearance means the rule regressed.
C8=0
grep -q 'id="bulk-style"' app.html && { fail "C8 app.html bulk-style dropdown is back"; C8=1; }
grep -q "ForEach(ArtStyle.allCases)" kid-ios/MyWorld/Views/TileEditSheet.swift && { fail "C8 iOS tile editor ArtStyle picker is back"; C8=1; }
grep -q "ForEach(ImageModel.allCases)" kid-ios/MyWorld/Views/TileEditSheet.swift && { fail "C8 iOS tile editor ImageModel picker is back"; C8=1; }
grep -q "localStorage.getItem('aacStyle')" parent.html && { fail "C8 parent.html reads the stale localStorage aacStyle string"; C8=1; }
[ "$C8" -eq 0 ] && pass "C8 no per-image style/model pickers"

# ── Vercel function ceiling (~100 routed functions) ──────────────────────────
COUNT=$(find api -name '*.js' ! -name '_*' ! -path 'api/_lib/*' | wc -l)
echo "INFO: routed Vercel functions: $COUNT / 100"
if [ "$COUNT" -ge 96 ]; then fail "function count $COUNT dangerously close to Vercel's 100 limit — use a _lab-* action instead"; fi

exit $FAIL
