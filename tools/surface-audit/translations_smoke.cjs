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

  // pizza's dictionary row is section/category-scoped; eat and cookie are
  // WILDCARD rows (no section/category), the shape most of the real
  // dictionary has. All three must line up with their clips — the launch bug
  // was an exact-key join that stranded every wildcard row with no dot and
  // no ▶, leaving Play all a queue of one.
  ok('a built word reads ready', (await dotFor('pizza')) === 'ready');
  ok('a wildcard dictionary row still gets its clip state', (await dotFor('eat')) === 'stale');
  ok('an unbuilt wildcard word reads no-clip', (await dotFor('cookie')) === 'missing');

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

  // Play all must walk EVERY translated row (wildcards included) — the
  // symptom of the join bug was "✓ Played 1 word" over a fully built set.
  await page.click('#playall');
  await page.waitForTimeout(1500);
  ok('play-all walks every translated word', await page.evaluate(() =>
    /Played 4 words/.test(document.getElementById('amsg').textContent)));

  // A language with no tagged voice must say so — this is the step whose
  // absence makes a translated board fall back to an English-language voice.
  await page.selectOption('#lang', 'de');
  await page.waitForTimeout(500);
  ok('a language with no voice warns and links to the voice lab', await page.evaluate(() => {
    const w = document.getElementById('voice-warn');
    return /No voice tagged/.test(w.textContent) && !!w.querySelector('a[href="/admin/voices.html"]');
  }));

  // A voice with an EMPTY dictionary: Build must say "seed first", never the
  // green "everything has a clip" message — which is vacuously true (zero
  // translated words all have clips) and operationally a lie.
  await page.selectOption('#lang', 'es');
  await page.waitForTimeout(500);
  await page.selectOption('#voice', 'esVoiceIdAAAAAAAA');
  await page.waitForTimeout(400);
  await page.click('#build');
  await page.waitForTimeout(300);
  const seedMsg = await page.evaluate(() => document.getElementById('amsg').textContent);
  ok('building an unseeded language says seed-first', /No es translations yet/.test(seedMsg)
    && /Seed the bundled dictionary/.test(seedMsg));
  ok('the unseeded case never claims clips are ready', !/current clip/.test(seedMsg));

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

  // Board truth: the chips must separate "the clip exists in the cache" from
  // "the child's tile actually points at it" — the gap between those two is
  // the whole "published but still speaks English" mystery.
  ok('child mode counts tiles still holding old clips', await page.evaluate(() =>
    /1oldclipsonboard/.test(document.getElementById('chips').textContent.replace(/\s+/g, ''))));
  ok('an outdated tile is badged on its row', await page.evaluate(() => {
    for (const tr of document.querySelectorAll('#rows tr')) {
      if (tr.children[0] && tr.children[0].textContent.trim() === 'eat') {
        return /↻/.test(tr.lastElementChild.innerHTML);
      }
    }
    return false;
  }));
  ok('a parent recording is badged as untouchable', await page.evaluate(() => {
    for (const tr of document.querySelectorAll('#rows tr')) {
      if (tr.children[0] && tr.children[0].textContent.trim() === 'help') {
        return /🎙/.test(tr.lastElementChild.innerHTML);
      }
    }
    return false;
  }));

  // Push from the bench: loops the publish action for this one board, then
  // re-verifies and reports what changed.
  ok('the push button appears only in child mode', await page.evaluate(() =>
    document.getElementById('pushchild').style.display !== 'none'));
  await page.click('#pushchild');
  await page.waitForTimeout(800);
  ok('pushing reports what it updated', await page.evaluate(() => {
    const t = document.getElementById('amsg').textContent;
    return /push complete/.test(t) && /1 clips updated/.test(t) && /Reload the board/.test(t);
  }));

  await page.click('#clearchild');
  await page.waitForTimeout(500);
  ok('clearing child mode restores the full dictionary', await page.evaluate(() =>
    document.querySelectorAll('#rows tr').length === 4));

  // A zh board whose SAVED voice is English-tagged: the bench must say the
  // words will come out in an English voice, not just report clip states.
  await page.fill('#child', 'mismatch-kid');
  await page.click('#checkchild');
  await page.waitForTimeout(600);
  ok('a wrong-language saved voice is called out', await page.evaluate(() => {
    const t = document.getElementById('amsg').textContent;
    return /saved voice is tagged/.test(t) && /en/.test(t) && /parent dashboard/.test(t);
  }));

  await browser.close();
  console.log(fails.length ? '\nFAILURES:\n' + fails.join('\n') : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
