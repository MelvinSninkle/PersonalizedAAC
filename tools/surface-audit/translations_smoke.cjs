// Runtime smoke for the Translations workbench (admin/translations.html)
// against the stub server. The bench is the only place a foreign language can
// be reviewed BEFORE it reaches a child's board, so what's asserted here is
// the review contract itself:
//   · a word with no translation is surfaced as "speaks English", not hidden
//   · clip state (ready / stale / no clip yet) is visible per word
//   · a language with no tagged voice says so — that missing voice is what
//     silently breaks the whole chain downstream
//   · auditioning a word reports whether the clip already existed
//   · child mode reports THAT board: its language, its voice, its tiles
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
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails.push(n); };
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 300)); });
  page.on('dialog', (d) => d.accept());

  const chipText = () => page.evaluate(() => document.getElementById('chips').textContent);
  const dotFor = (en) => page.evaluate((w) => {
    for (const tr of document.querySelectorAll('#rows tr')) {
      if (tr.children[0] && tr.children[0].textContent.trim() === w) {
        const s = tr.querySelector('.st');
        return s ? s.className.replace('st ', '') : null;
      }
    }
    return null;
  }, en);

  await page.goto('http://127.0.0.1:8765/admin/translations.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  ok('dictionary rows render', await page.evaluate(() =>
    document.querySelectorAll('#rows tr').length === 4));

  // The Chinese voice is the only zh-tagged one in the catalog.
  ok('voice picker offers only the language\'s voices', await page.evaluate(() => {
    const opts = [...document.getElementById('voice').options].map((o) => o.textContent);
    return opts.length === 2 && /Mei/.test(opts[1]);
  }));
  ok('no missing-voice warning when the language has one', await page.evaluate(() =>
    document.getElementById('voice-warn').textContent.trim() === ''));

  await page.selectOption('#voice', 'zhVoiceIdAAAAAAAA');
  await page.waitForTimeout(400);

  const chips = await chipText();
  ok('clip counts appear once a voice is picked', /2clipsready/.test(chips.replace(/\s+/g, '')));
  ok('untranslated words are counted as speaking English',
    /1speakEnglish/.test(chips.replace(/\s+/g, '')));
  ok('the English-speaking word is named in the missing panel', await page.evaluate(() =>
    /wonton soup/.test(document.getElementById('missing').textContent)));

  ok('a built word reads ready', (await dotFor('pizza')) === 'ready');
  ok('an edited translation reads stale', (await dotFor('eat')) === 'stale');
  ok('an unbuilt word reads no-clip', (await dotFor('cookie')) === 'missing');

  // Auditioning: the stub answers X-TTS-Cache: HIT, which proves the clip
  // already exists in the shared cache even though the index hadn't recorded
  // it — the dot flips without a build and without spending.
  await page.evaluate(() => {
    for (const tr of document.querySelectorAll('#rows tr')) {
      if (tr.children[0] && tr.children[0].textContent.trim() === 'cookie') tr.querySelector('button.play').click();
    }
  });
  await page.waitForTimeout(500);
  ok('a cache HIT on audition flips the word to ready', (await dotFor('cookie')) === 'ready');

  // A language with no tagged voice must say so — this is the step whose
  // absence makes a translated board fall back to an English-language voice.
  await page.selectOption('#lang', 'de');
  await page.waitForTimeout(500);
  ok('a language with no voice warns and links to the voice lab', await page.evaluate(() => {
    const w = document.getElementById('voice-warn');
    return /No voice tagged/.test(w.textContent) && !!w.querySelector('a[href="/admin/voices.html"]');
  }));

  // Child mode: the board's own settings win over both pickers, and the row
  // set narrows to the tiles that board actually has.
  await page.selectOption('#lang', 'zh');
  await page.waitForTimeout(400);
  await page.fill('#child', 'yixuan');
  await page.click('#checkchild');
  await page.waitForTimeout(600);
  ok('child mode names whose board is being reported', await page.evaluate(() =>
    /yixuan/.test(document.getElementById('amsg').textContent)));
  ok('child mode shows only that board\'s words', await page.evaluate(() =>
    document.querySelectorAll('#rows tr').length === 3));
  ok('child mode resolves that board\'s saved voice', await page.evaluate(() =>
    document.getElementById('voice').value === 'zhVoiceIdAAAAAAAA'));

  await page.click('#clearchild');
  await page.waitForTimeout(500);
  ok('clearing child mode restores the full dictionary', await page.evaluate(() =>
    document.querySelectorAll('#rows tr').length === 4));

  await browser.close();
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
