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

  // ── Feature 2: sentence constructor — real mouse drag to the header ──
  const tile = page.locator('.items-grid .tile-wrap').first();
  const tb = await tile.boundingBox();
  const hb = await page.locator('header').boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      tb.x + tb.width / 2 + (hb.x + hb.width / 2 - tb.x - tb.width / 2) * i / 8,
      tb.y + tb.height / 2 + (hb.y + hb.height / 2 - tb.y - tb.height / 2) * i / 8);
  }
  const hotDuringDrag = await page.evaluate(() => document.querySelector('header').classList.contains('sb-drop-hot'));
  await page.mouse.up();
  ok('header highlights during drag', hotDuringDrag);
  await page.waitForTimeout(400);
  ok('chip staged after drop', await page.evaluate(() => document.querySelectorAll('.sentence-chip').length) === 1);
  ok('body.sentence-active (chrome hidden)', await page.evaluate(() => document.body.classList.contains('sentence-active')));
  ok('header title hidden while composing', await page.evaluate(() => {
    const h1 = document.querySelector('.hdr-center h1');
    return getComputedStyle(h1).display === 'none';
  }));
  ok('play button visible', await page.evaluate(() => {
    const b = document.getElementById('sentence-play');
    return b && b.offsetParent !== null;
  }));
  ok('tile still on the board after drag', await page.evaluate(() => document.querySelectorAll('.items-grid .tile-wrap').length > 3));
  // chip tap removes it and empties the bar back to normal chrome
  await page.locator('.sentence-chip').first().click();
  await page.waitForTimeout(200);
  ok('chip tap removes + restores header', await page.evaluate(() =>
    !document.body.classList.contains('sentence-active') && document.querySelectorAll('.sentence-chip').length === 0));

  // ── Feature 2b: long-press lift (the default) ──
  await page.evaluate(() => window.__accessHooks.applyAccessSettings({ sentenceBuilder: true, sentenceLift: 'longpress' }));
  ok('longpress mode leaves touch-action alone', await page.evaluate(() =>
    !document.body.classList.contains('sb-lift-drag')));
  const tile2 = page.locator('.items-grid .tile-wrap').first();
  const t2 = await tile2.boundingBox();
  const h2 = await page.locator('header').boundingBox();
  // quick move without holding must NOT lift (that's a scroll/tap)
  await page.mouse.move(t2.x + 20, t2.y + 20);
  await page.mouse.down();
  await page.mouse.move(t2.x + 20, t2.y - 60);
  const liftedEarly = await page.evaluate(() => !!document.querySelector('.sb-drag-ghost'));
  await page.mouse.up();
  ok('longpress: quick move does not lift', liftedEarly === false);
  // hold 600ms, then drag to the header → stages
  await page.mouse.move(t2.x + 20, t2.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(600);
  const liftedAfterHold = await page.evaluate(() => !!document.querySelector('.sb-drag-ghost'));
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(t2.x + 20 + (h2.x + h2.width / 2 - t2.x - 20) * i / 6,
                          t2.y + 20 + (h2.y + h2.height / 2 - t2.y - 20) * i / 6);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok('longpress: hold lifts the tile', liftedAfterHold === true);
  ok('longpress: drop on bar stages a chip', await page.evaluate(() =>
    document.querySelectorAll('.sentence-chip').length) === 1);
  await page.evaluate(() => window.__accessHooks.sbClear());

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
