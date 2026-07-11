// Runtime smoke for the PUBLIC practice board (practice.html) against the
// stub server. Verifies the page renders, taps count local-only stats, no
// add/edit affordances exist, and the network surface is demo+media ONLY —
// the A-PUBLIC invariant from the surface-audit skill.
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const fs = require('fs');
const EXE = process.env.CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

(async () => {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const fails = [];
  const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  const reqs = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(r.url()); });

  await page.goto('http://127.0.0.1:8765/practice.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  ok('tiles render', await page.evaluate(() => document.querySelectorAll('.tile').length) > 10);
  ok('voice chips render', await page.evaluate(() => document.querySelectorAll('.voice-chip').length) >= 1);
  await page.locator('#board .tile').first().click();
  await page.waitForTimeout(300);
  ok('tap counts local stats', await page.evaluate(() => document.getElementById('st-taps').textContent) === '1');
  ok('no add/edit affordances', await page.evaluate(() =>
    !document.body.innerHTML.match(/Add tile|New Category|\+ Add/i)));
  ok('only demo/media APIs touched', reqs.length > 0 && reqs.every((u) =>
    u.includes('/api/media') || u.includes('/api/demo')));

  await browser.close();
  console.log(fails.length ? 'FAILURES: ' + JSON.stringify(fails) : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
