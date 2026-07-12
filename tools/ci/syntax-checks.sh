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

echo "ALL SYNTAX CHECKS PASS"
