#!/usr/bin/env bash
# CI syntax gate: every serverless function parses, every inline <script> in
# the big HTML surfaces parses, every i18n dictionary is valid JSON with full
# coverage of the taxonomy seed. Run from repo root.
set -eu
cd "$(dirname "$0")/../.."

echo "── node --check every api/**/*.js ──"
find api -name '*.js' -print0 | xargs -0 -n 20 node --check
echo "OK: $(find api -name '*.js' | wc -l) files"

echo "── inline <script> blocks in the HTML surfaces ──"
python3 - <<'EOF'
import re, subprocess, sys, tempfile, os
fails = 0
for f in ['app.html', 'parent.html', 'onboard.html', 'store.html', 'practice.html', 'index.html']:
    if not os.path.exists(f): continue
    html = open(f, encoding='utf-8').read()
    blocks = re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', html, re.S)
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as t:
        t.write('\n;\n'.join(blocks)); path = t.name
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    os.unlink(path)
    print(f, 'PASS' if r.returncode == 0 else 'FAIL\n' + r.stderr[:800])
    fails += r.returncode != 0
sys.exit(1 if fails else 0)
EOF

echo "── i18n dictionaries: parse + full seed coverage ──"
python3 - <<'EOF'
import csv, json, sys
seed = {r['label'].strip().lower() for r in csv.DictReader(open('taxonomy/seed-core-v1.csv'))}
fails = 0
for lang in ['zh', 'es', 'fr', 'pt', 'de']:
    d = json.load(open(f'api/_lib/i18n/{lang}.json'))
    have = {e['en'].strip().lower() for e in d['entries']}
    empty = [e for e in d['entries'] if not str(e.get('t') or e.get('zh') or '').strip()]
    missing = sorted(seed - have)
    status = 'PASS' if not missing and not empty else 'FAIL'
    print(f"{lang}: {len(d['entries'])} entries, {len(missing)} missing, {len(empty)} empty — {status}")
    if missing[:5]: print('  missing:', missing[:5])
    fails += bool(missing or empty)
sys.exit(1 if fails else 0)
EOF

# ── word-match engine sanity: the synonym sets actually expand ──────────────
# The SYNONYM_SETS live in code (like IRREGULAR) and feed every board's
# listening lexicon at sync; a refactor that silently drops them would break
# spoken-synonym matching everywhere with no visible error.
node -e '
import("./api/_lib/word-match.js").then((m) => {
  // Explicit {synonyms} both ways so this guard survives the SYNONYMS_PUBLIC
  // graduation flip: on = sets expand; off = they must stay out.
  const hello = m.expandMatchTerms("hello", [], { synonyms: true });
  const dog = m.expandMatchTerms("dog", [], { synonyms: true });
  const dark = m.expandMatchTerms("hello", [], { synonyms: false });
  if (!hello.includes("hi") || !hello.includes("hey") || !dog.includes("puppy")) {
    console.error("FAIL word-match synonyms: hello →", hello.join(","), "dog →", dog.join(","));
    process.exit(1);
  }
  if (dark.includes("hi") || dark.includes("hey")) {
    console.error("FAIL word-match gate: {synonyms:false} still expanded →", dark.join(","));
    process.exit(1);
  }
  // Phrase tiles: shortened forms + the punctuation-stripped set lookup
  // (a label like "How are you?" must still find its bare-keyed set).
  const want = m.expandMatchTerms("I want", [], { synonyms: true });
  const how = m.expandMatchTerms("How are you?", [], { synonyms: true });
  if (!want.includes("want") || !how.includes("how are you doing")) {
    console.error("FAIL word-match phrases: I want →", want.join(","), "How are you? →", how.join(","));
    process.exit(1);
  }
  console.log("word-match synonyms: PASS (hello → hi/hey, dog → puppy, I want → want, punctuation lookup; gate off excludes)");
})' || exit 1

echo "ALL SYNTAX CHECKS PASS"
