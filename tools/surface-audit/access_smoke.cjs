// Playwright resolution: plain `playwright` in CI (npm i playwright +
// npx playwright install chromium); the /opt paths are the Claude Code
// remote-environment fallbacks.
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
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  fails.length = 0;
  const ok = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) fails.push(name); };
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 300)); });

  await page.goto('http://127.0.0.1:8765/app.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.items-grid .tile-wrap').length > 3, { timeout: 15000 });
  // First-boot role picker covers the page in a fresh profile — enter kid mode.
  const roleBtn = page.locator('#role-modal .role-pick[data-role="child"]');
  if (await roleBtn.isVisible().catch(() => false)) { await roleBtn.click(); await page.waitForTimeout(300); }
  ok('board renders tiles', true);
  ok('hooks exposed', await page.evaluate(() => !!window.__accessHooks));

  // ── Feature 1: button navigation ──
  await page.evaluate(() => window.__accessHooks.applyAccessSettings({ navMode: 'buttons', sentenceBuilder: true, sentenceLift: 'drag', sentenceIdleMin: 2, listenRepeatNav: true }));
  ok('body.nav-buttons-mode', await page.evaluate(() => document.body.classList.contains('nav-buttons-mode')));
  ok('pager bars inserted (10)', await page.evaluate(() => document.querySelectorAll('.pager-bar').length) === 10);
  const overflowing = await page.evaluate(() => document.querySelectorAll('.pager-bar.has-overflow').length);
  console.log('  pager bars showing (overflow present):', overflowing);
  ok('at least one overflowing pager', overflowing >= 1);
  const scrolled = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.pager-bar.has-overflow')][0];
    if (!p) return null;
    const el = p.previousElementSibling;
    const before = el.scrollTop + el.scrollLeft;
    p.querySelectorAll('.pager-btn')[1].click();
    return (el.scrollTop + el.scrollLeft) > before;
  });
  ok('next-page button scrolls a full page', scrolled === true);
  const aligned = await page.evaluate(() => {
    // after paging, the first visible child should sit at (or within 2px of)
    // the leading edge — the "cut-off tile becomes first tile" rule
    const p = [...document.querySelectorAll('.pager-bar.has-overflow')][0];
    const el = p.previousElementSibling;
    const r = el.getBoundingClientRect();
    const kids = [...el.children].map(k => k.getBoundingClientRect());
    const x = el.scrollWidth > el.clientWidth;
    const first = kids.find(k => (x ? k.right - r.left : k.bottom - r.top) > 2);
    const atMax = x ? el.scrollLeft >= el.scrollWidth - el.clientWidth - 1
                    : el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
    return atMax || Math.abs(x ? first.left - r.left : first.top - r.top) < 3;
  });
  ok('page aligns to tile boundary', aligned === true);

  // ── Feature 2: sentence bar chrome (staged programmatically; staging is
  //    a tap in pencil mode now — the drag flow is gone by design) ──
  await page.evaluate(async () => {
    const items = await window.__accessHooks.getAllItems('nouns');
    window.__accessHooks.sbStage(items[0]);
  });
  await page.waitForTimeout(400);
  ok('chip staged', await page.evaluate(() => document.querySelectorAll('.sentence-chip').length) === 1);
  ok('body.sentence-active (chrome hidden)', await page.evaluate(() => document.body.classList.contains('sentence-active')));
  ok('header title hidden while composing', await page.evaluate(() => {
    const h1 = document.querySelector('.hdr-center h1');
    return getComputedStyle(h1).display === 'none';
  }));
  ok('play button visible', await page.evaluate(() => {
    const b = document.getElementById('sentence-play');
    return b && b.offsetParent !== null;
  }));
  ok('tile still on the board after staging', await page.evaluate(() => document.querySelectorAll('.items-grid .tile-wrap').length > 3));
  // chip tap removes it and empties the bar back to normal chrome
  await page.locator('.sentence-chip').first().click();
  await page.waitForTimeout(200);
  ok('chip tap removes + restores header', await page.evaluate(() =>
    !document.body.classList.contains('sentence-active') && document.querySelectorAll('.sentence-chip').length === 0));

  // ── Feature 2b: sentence MODE (the pencil) — modal, not gestural ──
  await page.evaluate(() => window.__accessHooks.applyAccessSettings({ sentenceBuilder: true }));
  await page.evaluate(() => window.__accessHooks.sbSetMode(true));
  ok('pencil mode forces button navigation', await page.evaluate(() =>
    document.body.classList.contains('nav-buttons-mode') && document.body.classList.contains('sentence-mode')));
  const tile2 = page.locator('.items-grid .tile-wrap').first();
  await tile2.click();
  await page.waitForTimeout(300);
  ok('sentence mode: a tap stages the tile silently', await page.evaluate(() =>
    document.querySelectorAll('.sentence-chip').length === 1));
  await page.evaluate(() => window.__accessHooks.sbSetMode(false));
  ok('pencil off restores scroll nav + clears the bar', await page.evaluate(() =>
    !document.body.classList.contains('nav-buttons-mode')
    && !document.body.classList.contains('sentence-mode')
    && document.querySelectorAll('.sentence-chip').length === 0));

  // ── Regression guard: NOTHING may ever disable touch scrolling on the
  //    web board. The old drag-lift set touch-action:none on tiles; the
  //    drag gesture now lives in the native apps only (sentenceDrag). ──
  await page.evaluate(() => window.__accessHooks.applyAccessSettings({ sentenceBuilder: true, sentenceDrag: true }));
  ok('no tile ever gets touch-action:none', await page.evaluate(() =>
    [...document.querySelectorAll('.items-grid .tile-wrap, .needs-strip .tile-wrap')]
      .every(el => getComputedStyle(el).touchAction !== 'none')));

  // ── Feature 3: repeat-navigate core ──
  const nav = await page.evaluate(async () => {
    const items = await window.__accessHooks.getAllItems('nouns');
    const it = items.find(i => i.categoryId != null) || items[0];
    if (!it) return { ok: false, why: 'no items' };
    await window.__accessHooks.navigateToTile(it);
    const el = document.querySelector('.tile-wrap.listen-hit');
    return { ok: !!el, id: it.id };
  });
  ok('navigateToTile highlights the tile yellow', nav.ok === true);

  // idle-clear sanity (short-circuit the timer rather than waiting a minute)
  await page.evaluate(async () => {
    const items = await window.__accessHooks.getAllItems('nouns');
    await window.__accessHooks.sbStage(items[0]);
  });
  await page.waitForTimeout(200);
  const staged = await page.evaluate(() => document.querySelectorAll('.sentence-chip').length);
  await page.evaluate(() => window.__accessHooks.sbClear());
  ok('programmatic stage + clear cycle', staged === 1 && await page.evaluate(() =>
    !document.body.classList.contains('sentence-active')));

  // scroll mode restores everything
  await page.evaluate(() => window.__accessHooks.applyAccessSettings({}));
  ok('defaults restore scroll mode', await page.evaluate(() =>
    !document.body.classList.contains('nav-buttons-mode') && !document.body.classList.contains('sb-on')));

  await browser.close();
  console.log(fails.length ? '\nFAILURES: ' + JSON.stringify(fails) : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e && e.message ? e.message.split('\n')[0] : e);
  if (fails.length) console.error('collected failures:', JSON.stringify(fails));
  process.exit(1);
});
