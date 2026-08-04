// Runtime smoke for the EMERGENCY BEACON (lost-child mode) on the web board,
// against the stub server. The stub arms the beacon only when the page
// carries a beacon=1 cookie, so the other board smokes never see it. What's
// asserted is the emergency contract itself:
//   · an armed sync lights the beacon: banner + flashing family screen
//   · the screen leads with the FAMILY language, then English, and shows the
//     photos and the phone number a rescuer needs
//   · the child cannot stop it — the stop pane demands a parent credential
//     and rejects a wrong one
//   · the overlay recedes to the banner so the board stays the child's voice
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const fs = require('fs');
const EXE = process.env.CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

async function launchBrowser() {
  if (EXE) return chromium.launch({ executablePath: EXE });
  try { return await chromium.launch({ channel: 'chromium' }); }
  catch (_) { return chromium.launch(); }
}

const fails = [];
(async () => {
  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.addCookies([{ name: 'beacon', value: '1', url: 'http://127.0.0.1:8765' }]);
  const page = await context.newPage();
  const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:8765/u/testchild', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.items-grid .tile-wrap').length > 3, { timeout: 15000 });
  const roleBtn = page.locator('#role-modal .role-pick[data-role="child"]');
  if (await roleBtn.isVisible().catch(() => false)) { await roleBtn.click(); await page.waitForTimeout(300); }
  await page.waitForTimeout(1200);

  ok('an armed sync lights the banner', await page.evaluate(() =>
    !!document.getElementById('beacon-banner')));
  // The first announcement's overlay may already have receded to the banner
  // by now (that's the design) — bring the screen up deterministically.
  await page.click('#beacon-banner');
  await page.waitForTimeout(2600);   // photo loader retries cover the boot race
  ok('the emergency screen appears', await page.evaluate(() => {
    const o = document.getElementById('beacon-overlay');
    return !!o && o.style.display !== 'none';
  }));
  ok('the family language leads, English follows', await page.evaluate(() => {
    const t = (document.getElementById('beacon-overlay') || {}).textContent || '';
    return t.indexOf('这是我的家人') !== -1 && t.indexOf('This is My Family') !== -1
      && t.indexOf('这是我的家人') < t.indexOf('This is My Family');
  }));
  ok('the phone number is displayed large', await page.evaluate(() =>
    /\(555\) 010-4477/.test((document.getElementById('beacon-overlay') || {}).textContent || '')));
  ok('family photos render from the board\'s own cached art', await page.evaluate(() =>
    document.querySelectorAll('#beacon-photos img').length >= 1));

  // The stop pane: a wrong credential must be rejected (no PIN is set in this
  // fresh profile and the stub has no auth, so nothing can verify — exactly
  // the child-poking-at-it case).
  await page.click('#beacon-stop');
  await page.waitForTimeout(200);
  ok('stop demands a caregiver credential', await page.evaluate(() =>
    !!document.getElementById('beacon-stop-pane')));
  await page.fill('#beacon-stop-secret', '0000');
  await page.click('#beacon-stop-go');
  await page.waitForTimeout(600);
  ok('a wrong credential does not stop the beacon', await page.evaluate(() =>
    !!document.getElementById('beacon-banner')
    && /didn.t match/i.test(document.getElementById('beacon-stop-err').textContent)));

  // The board stays the child's voice: dismissing the overlay keeps the
  // banner (and the beacon) while the tiles are usable again.
  await page.click('#beacon-dismiss');
  await page.waitForTimeout(300);
  ok('overlay recedes to the banner, board usable', await page.evaluate(() =>
    document.getElementById('beacon-overlay').style.display === 'none'
    && !!document.getElementById('beacon-banner')
    && document.querySelectorAll('.items-grid .tile-wrap').length > 3));

  await browser.close();
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
