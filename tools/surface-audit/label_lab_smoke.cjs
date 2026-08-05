// Runtime smoke for the Label Lab (admin/label-lab.html) against the stub
// server. The lab composites a caption band onto finished tile art entirely
// client-side (canvas) — the contract checked here:
//   · tiles load from the public /api/demo projection (no new server surface)
//   · the band is drawn: sharp top edge, rounded bottom corners
//   · controls re-render live (band color change reaches the pixels)
//   · CJK text renders without error — the reason this lab exists
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));

  await page.goto('http://127.0.0.1:8765/admin/label-lab.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  ok('board words load from /api/demo', await page.evaluate(() =>
    /tiles with art loaded/.test(document.getElementById('msg').textContent)));

  const px = (x, y) => page.evaluate(([x, y]) => {
    const d = document.getElementById('cv-main').getContext('2d').getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, [x, y]);

  // Default band: white, 160px tall, 56px bottom radius on a 1024 canvas.
  const mid = await px(512, 990);
  ok('band is drawn at the bottom', mid[0] === 255 && mid[1] === 255 && mid[2] === 255 && mid[3] === 255);
  const inBand = await px(300, 1021);
  const corner = await px(3, 1021);
  ok('bottom corners are rounded (corner pixel is not band)',
    inBand[0] === 255 && inBand[1] === 255 && inBand[2] === 255
    && !(corner[0] === 255 && corner[1] === 255 && corner[2] === 255 && corner[3] === 255));

  // Live control: change the band color and the pixels must follow.
  await page.evaluate(() => {
    const el = document.getElementById('band-color');
    el.value = '#ff00aa';
    el.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(400);
  const pink = await px(512, 990);
  ok('band color control re-renders the canvas', pink[0] === 255 && pink[1] === 0 && pink[2] === 170);

  // CJK: type the words that image models mangle — a real font must not.
  await page.fill('#text', '饺子');
  await page.evaluate(() => document.getElementById('text').dispatchEvent(new Event('input')));
  await page.waitForTimeout(500);
  ok('CJK label text renders without error', fails.every((f) => !f.startsWith('pageerror')));

  ok('uniformity strip renders six tiles', await page.evaluate(() =>
    document.querySelectorAll('#strip canvas').length === 6));

  ok('width sweep renders five sizes with effective pixel captions', await page.evaluate(() => {
    const caps = [...document.querySelectorAll('#sweep .cap')].map((c) => c.textContent);
    return caps.length === 5 && /80px · band \d+px · text ~\d+px/.test(caps[4]);
  }));

  // "Art is its own label": skipping a category must remove the band from its
  // tiles. Pick pizza (category Food), skip Food, and the band pixel must no
  // longer be the band color.
  await page.fill('#search', 'pizza');
  await page.evaluate(() => document.getElementById('search').dispatchEvent(new Event('change')));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const box = [...document.querySelectorAll('#skip-cats input')].find((i) => i.value === 'food');
    if (box && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change')); }
  });
  await page.waitForTimeout(500);
  const skipped = await px(512, 990);
  ok('a skipped category renders with no band',
    !(skipped[0] === 255 && skipped[1] === 0 && skipped[2] === 170));
  ok('the skip list travels in the settings JSON', await page.evaluate(() => {
    const cfg = JSON.parse(localStorage.getItem('labelLabCfg') || '{}');
    return Array.isArray(cfg.skipCategories) && cfg.skipCategories.includes('food');
  }));

  await browser.close();
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
