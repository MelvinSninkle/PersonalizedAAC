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

// Prefer the FULL Chromium build: Playwright's default headless is the
// stripped "headless shell", which broke the board render in CI. channel
// 'chromium' selects the full build's new headless mode.
async function launchBrowser() {
  if (EXE) return chromium.launch({ executablePath: EXE });
  try { return await chromium.launch({ channel: 'chromium' }); }
  catch (_) { return chromium.launch(); }
}

const fails = [];
(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  fails.length = 0;
  const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 300)); });
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

  // ── Style switcher (published styles browsable on the public demo) ──
  ok('style switcher renders', await page.evaluate(() =>
    document.querySelectorAll('#styles .voice-chip').length >= 2));   // Classic + stub style
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#styles .voice-chip')];
    chips[chips.length - 1].click();   // the stubbed "Watercolor" style
  });
  await page.waitForTimeout(600);
  ok('switching style re-renders styled art', await page.evaluate(() =>
    [...document.querySelectorAll('#board .tile .sq')]
      .some((el) => decodeURIComponent(el.style.backgroundImage || '').includes('style-defaults/'))));
  ok('board still renders after the switch', await page.evaluate(() =>
    document.querySelectorAll('.tile').length > 10));

  // ── Demo-kid switcher (styles can offer more than one demo child) ──
  ok('kid switcher renders in styled mode', await page.evaluate(() => {
    const bar = document.getElementById('kid-bar');
    return !!bar && bar.style.display !== 'none'
      && document.querySelectorAll('#kids .voice-chip').length >= 2;   // primary + Maya
  }));
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#kids .voice-chip')];
    chips[chips.length - 1].click();   // the stubbed "Maya" kid
  });
  await page.waitForTimeout(600);
  ok('switching kid re-renders person tiles', await page.evaluate(() =>
    [...document.querySelectorAll('#board .tile .sq')]
      .some((el) => decodeURIComponent(el.style.backgroundImage || '').includes('kid-3-people'))));

  // ── Board-parity layout: fixed viewport, pinned needs strip, verbs live ──
  ok('fixed viewport (page never scrolls)', await page.evaluate(() =>
    getComputedStyle(document.body).overflow === 'hidden'));
  ok('needs strip renders after the board', await page.evaluate(() => {
    const n = document.getElementById('needs');
    return !!n && n.style.display !== 'none' && n.querySelectorAll('.tile').length >= 1;
  }));
  ok('verbs column shows tiles in styled mode', await page.evaluate(() =>
    [...document.querySelectorAll('#board .col')].some((c) =>
      (c.querySelector('h2') || {}).textContent === 'Verbs' && c.querySelectorAll('.tile').length > 0)));

  // ── ⚙ Display panel: session-only look controls (sessionStorage, no API) ──
  await page.locator('#disp-btn').click();
  await page.waitForTimeout(200);
  ok('display panel opens', await page.evaluate(() =>
    document.getElementById('disp-panel').style.display === 'flex'));
  await page.locator('#pd-hide-labels').check();
  await page.waitForTimeout(300);
  ok('hide labels hides tile words + headers', await page.evaluate(() =>
    document.body.classList.contains('hide-labels')
      && getComputedStyle(document.querySelector('#board .tile .lb')).display === 'none'));
  ok('tiles across re-shapes a column', await page.evaluate(() => {
    const el = document.getElementById('pd-across-nouns');
    el.value = '3';
    el.dispatchEvent(new Event('change'));
    const col = [...document.querySelectorAll('#board .col')].find((c) => c.dataset.section === 'nouns');
    return col && col.style.getPropertyValue('--across') === '3';
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  ok('display prefs survive a reload in the same session', await page.evaluate(() =>
    document.body.classList.contains('hide-labels')
      && sessionStorage.getItem('practiceDisplay') !== null
      && localStorage.getItem('practiceDisplay') === null));

  ok('only demo/media/style-thumb APIs touched', reqs.length > 0 && reqs.every((u) =>
    u.includes('/api/media') || u.includes('/api/demo') || u.includes('/api/style-guides/public')));

  await browser.close();
  console.log(fails.length ? 'FAILURES: ' + JSON.stringify(fails) : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e && e.message ? e.message.split('\n')[0] : e);
  if (fails.length) console.error('collected failures:', JSON.stringify(fails));
  process.exit(1);
});
