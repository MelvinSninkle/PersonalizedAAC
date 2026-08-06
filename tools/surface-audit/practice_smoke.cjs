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

  // ── Welcome tour: front-and-center on first visit, dismissable ──
  ok('welcome tour opens on first visit', await page.evaluate(() =>
    document.getElementById('tour-modal').classList.contains('show')));
  await page.locator('#tour-close').click();
  await page.waitForTimeout(200);
  ok('tour dismisses (session-only)', await page.evaluate(() =>
    !document.getElementById('tour-modal').classList.contains('show')));

  ok('tiles render', await page.evaluate(() => document.querySelectorAll('.tile').length) > 10);
  ok('tier rings color-code sections', await page.evaluate(() => {
    const cols = [...document.querySelectorAll('#board .col')];
    const nouns = cols.find((c) => c.dataset.section === 'nouns');
    const people = cols.find((c) => c.dataset.section === 'people');
    return !!nouns.querySelector('.tile.tier-pro') && !nouns.querySelector('.tile.tier-plus')
        && !!people.querySelector('.tile.tier-plus') && !people.querySelector('.tile.tier-pro');
  }));
  ok('voice picker renders', await page.evaluate(() =>
    document.querySelectorAll('#sel-voice option').length >= 1));   // Device voice at minimum
  await page.locator('#board .tile').first().click();
  await page.waitForTimeout(300);
  ok('tap counts local stats', await page.evaluate(() => document.getElementById('st-taps').textContent) === '1');
  ok('no add/edit affordances', await page.evaluate(() =>
    !document.body.innerHTML.match(/Add tile|New Category|\+ Add/i)));

  // ── New defaults: pictures-first (labels hidden) on a white frame ──
  ok('labels hidden by default', await page.evaluate(() =>
    document.body.classList.contains('hide-labels')
      && getComputedStyle(document.querySelector('#board .tile .lb')).display === 'none'));
  ok('white board frame by default', await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)'));

  // ── Curated layout: chips follow server tile order, not the alphabet ──
  ok('category chips honor curated (non-alphabetical) order', await page.evaluate(() => {
    const col = [...document.querySelectorAll('#board .col')].find((c) => c.dataset.section === 'nouns');
    const labels = [...col.querySelectorAll('.chips .chip .lb')].map((el) => el.textContent);
    return labels[0] === 'Toys' && labels[1] === 'Food';
  }));

  // ── Label band: the Label Lab recipe deployed live on the demo board ──
  await page.waitForFunction(() => document.querySelectorAll('#board .tile .sq .band').length > 3, { timeout: 8000 });
  ok('caption bands render on art tiles', await page.evaluate(() => {
    const b = document.querySelector('#board .tile.banded .sq .band');
    return !!b && b.textContent.length > 0;
  }));
  ok('band carries the word; the separate label stays hidden', await page.evaluate(() => {
    const t = document.querySelector('#board .tile.banded');
    return t.querySelector('.sq .band').textContent === t.querySelector('.lb').textContent
      && getComputedStyle(t.querySelector('.lb')).display === 'none';
  }));
  // PROPORTIONAL, not merely >0: the first deploy shipped a fit pass that
  // measured the band against itself and shrank every word to ~43% of the
  // recipe. A short word must hold ≥9% of the tile width (recipe is ~10.9%).
  ok('band text holds the recipe size (~11% of tile width)', await page.evaluate(() => {
    const b = document.querySelector('#board .tile.banded .sq .band');
    const w = b.parentElement.clientWidth;
    return parseFloat(b.style.fontSize || '0') >= w * 0.09;
  }));
  ok('needs strip tiles carry bands too', await page.evaluate(() =>
    document.querySelectorAll('#needs-grid .tile .sq .band').length >= 1));
  ok('own-label category (Letters) skips the band', await page.evaluate(() => {
    const col = [...document.querySelectorAll('#board .col')].find((c) => c.dataset.section === 'nouns');
    const chip = [...col.querySelectorAll('.chips .chip')].find((c) => c.querySelector('.lb').textContent === 'Letters');
    if (!chip) return false;
    chip.click();
    return new Promise((res) => setTimeout(() => {
      const col2 = [...document.querySelectorAll('#board .col')].find((c) => c.dataset.section === 'nouns');
      const tiles = [...col2.querySelectorAll('.grid .tile')];
      res(tiles.length >= 1 && tiles.every((t) => !t.querySelector('.band')));
    }, 200));
  }));
  // Put the nouns column back on Toys so later assertions see the usual grid.
  await page.evaluate(() => {
    const col = [...document.querySelectorAll('#board .col')].find((c) => c.dataset.section === 'nouns');
    [...col.querySelectorAll('.chips .chip')].find((c) => c.querySelector('.lb').textContent === 'Toys').click();
  });
  await page.waitForTimeout(250);

  // ── Single-strip toolbar + live listening demo (driven micless via hook) ──
  ok('toolbar strip carries the listening button', await page.evaluate(() => {
    const bar = document.getElementById('main-toolbar');
    return !!bar && !!bar.querySelector('#listen-btn');
  }));
  ok('listening matches a tile and masks a bad word', await page.evaluate(() => {
    const tokens = window.practiceHooks.listenTokens('pizza is damn good');
    const bar = document.getElementById('listen-bar');
    const chipWords = [...bar.querySelectorAll('.lchip .lb')].map((el) => el.textContent);
    const masked = [...bar.querySelectorAll('.ltext.masked')].map((el) => el.textContent);
    return tokens.some((t) => t.tile && t.word === 'pizza')
      && chipWords.includes('pizza')
      && masked.includes('Bad Word')
      && !bar.textContent.includes('damn');
  }));
  ok('listening matchTerms inflections match too', await page.evaluate(() =>
    window.practiceHooks.listenTokens('two pizzas please').some((t) => t.tile && t.word === 'pizza')));

  // ── Style switcher (published styles browsable on the public demo) ──
  ok('style switcher renders', await page.evaluate(() =>
    document.querySelectorAll('#sel-style option').length >= 2));   // Classic + stub style
  await page.evaluate(() => {
    const sel = document.getElementById('sel-style');
    sel.value = sel.options[sel.options.length - 1].value;   // the stubbed "Watercolor" style
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(600);
  ok('switching style re-renders styled art', await page.evaluate(() =>
    [...document.querySelectorAll('#board .tile .sq')]
      .some((el) => decodeURIComponent(el.style.backgroundImage || '').includes('style-defaults/'))));
  ok('board still renders after the switch', await page.evaluate(() =>
    document.querySelectorAll('.tile').length > 10));
  ok('caption bands survive a style switch', await page.evaluate(() =>
    document.querySelectorAll('#board .tile.banded .sq .band').length > 3));

  // ── Demo-kid switcher (styles can offer more than one demo child) ──
  ok('kid switcher renders in styled mode', await page.evaluate(() => {
    const wrap = document.getElementById('kid-wrap');
    return !!wrap && wrap.style.display !== 'none'
      && document.querySelectorAll('#sel-kid option').length >= 2;   // primary + Maya
  }));
  await page.evaluate(() => {
    const sel = document.getElementById('sel-kid');
    sel.value = sel.options[sel.options.length - 1].value;   // the stubbed "Maya" kid
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(600);
  ok('switching kid re-renders person tiles', await page.evaluate(() =>
    [...document.querySelectorAll('#board .tile .sq')]
      .some((el) => decodeURIComponent(el.style.backgroundImage || '').includes('kid-3-people'))));
  ok('caption bands survive a kid switch', await page.evaluate(() =>
    document.querySelectorAll('#board .tile.banded .sq .band').length > 3));

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

  // ── ⚙ Display modal: session-only look controls (sessionStorage, no API) ──
  await page.locator('#disp-btn').click();
  await page.waitForTimeout(200);
  ok('display modal opens', await page.evaluate(() =>
    document.getElementById('disp-modal').classList.contains('show')));
  await page.locator('#pd-hide-labels').uncheck();
  await page.waitForTimeout(300);
  // With bands live, every art tile's word rides IN the band (its .lb stays
  // hidden by design) — unhiding labels brings back the word CHROME: the
  // section headers and chip labels.
  ok('unhiding labels shows the word chrome again', await page.evaluate(() =>
    !document.body.classList.contains('hide-labels')
      && getComputedStyle(document.querySelector('#board .col h2')).display !== 'none'));
  ok('tiles across re-shapes a column', await page.evaluate(() => {
    const el = document.getElementById('pd-across-nouns');
    el.value = '3';
    el.dispatchEvent(new Event('change'));
    const col = [...document.querySelectorAll('#board .col')].find((c) => c.dataset.section === 'nouns');
    return col && col.style.getPropertyValue('--across') === '3';
  }));
  await page.locator('#pd-done').click();
  await page.waitForTimeout(200);
  ok('display modal closes', await page.evaluate(() =>
    !document.getElementById('disp-modal').classList.contains('show')));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  ok('display prefs survive a reload in the same session', await page.evaluate(() =>
    !document.body.classList.contains('hide-labels')   // the labels-ON override persisted
      && sessionStorage.getItem('practiceDisplay') !== null
      && localStorage.getItem('practiceDisplay') === null));

  // ── ?bands=0 kill switch: the pre-band look for comparison ──
  await page.goto('http://127.0.0.1:8765/practice.html?bands=0', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#board .tile').length > 3, { timeout: 8000 });
  ok('?bands=0 renders no bands', await page.evaluate(() =>
    document.querySelectorAll('.tile .sq .band').length === 0));

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
