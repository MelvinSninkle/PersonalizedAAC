# Emoji audit — full inventory

Generated 2026-07-21 (Cleanup Task A). **Inventory only — nothing was removed or altered.**

One row per source line containing at least one emoji; the Emoji column lists the distinct emoji on that line.


Review guide:

- Sections are ordered by customer exposure: web pages first, then native apps, admin, API strings, docs/tooling.

- The child board deliberately uses emoji as icon-language in a few places (e.g. the ✏️ edit pencil, header tool icons, feelings faces). Flagged, not removed, per the task note.

- Emoji inside code comments or console.log lines never reach a customer; they are listed for completeness and marked implicitly by their context.

- A few rows are typographic glyphs rather than true emoji (the → link arrows and the ✕ close buttons). They are included for completeness since they render icon-like; safe to leave as-is.


## 1 · Customer-visible web pages — 480 lines across 11 files


### `parent.html` (165 lines)

| Line | Emoji | Context |
|---:|---|---|
| 254 | 🛍🧬 | `…d="store-link" style="font-weight:700;">🛍️ Word Store <span id="store-balance"></span></a> · <span i…` |
| 262 | 👋 | `…ting" style="margin-top:24px;">Hi there 👋</h1>` |
| 269 | 🎨 | `<span style="font-size:26px;">🎨</span>` |
| 278 | ✨ | `…n class="btn primary" id="seed-now-btn">✨ Generate starter words</button>` |
| 279 | → | `…rd-nudge-go" href="/onboard">Full setup →</a>` |
| 286 | ✨ | `<span style="font-size:24px;">✨</span>` |
| 301 | 💡 | `<h2>💡 Words your family says` |
| 305 | ⭐ | `…he word in the board's style and voice (⭐1). Dismiss hides it until it's heard again; Never stops th…` |
| 310 | ✨ | `<h2>✨ New tiles to review` |
| 326 | 🏠 | `…tab active" data-pane="home" role="tab">🏠 Home</button>` |
| 327 | 📈 | `…="ptab" data-pane="progress" role="tab">📈 Progress</button>` |
| 328 | 🧩 | `…ass="ptab" data-pane="board" role="tab">🧩 Board</button>` |
| 329 | ⏰ | `…="ptab" data-pane="routines" role="tab">⏰ Routines</button>` |
| 330 | 👤 | `…s="ptab" data-pane="account" role="tab">👤 Account</button>` |
| 345 | ✨ | `…d="moments-label" style="display:none;">✨ Moments</div>` |
| 354 | 🎮 | `<span style="font-size:22px;">🎮</span>` |
| 357 | ✕ | `…b7280; font-size:18px; cursor:pointer;">✕</button>` |
| 364 | 🎙 | `…"listen-toggle" style="font-size:16px;">🎙️ Start listening on the tablet</button>` |
| 372 | 🎯 | `<div class="icon">🎯</div><span class="tag">Mode 1 · Active</span>` |
| 381 | 🧑🏫 | `<div class="icon">🧑‍🏫</div><span class="tag">Mode 2 · Active</span>` |
| 390 | 📺 | `<div class="icon">📺</div><span class="tag">Mode 3 · Passive</span>` |
| 399 | 🌱 | `<div class="icon">🌱</div><span class="tag">Mode 4 · Passive</span>` |
| 408 | 📖 | `<div class="icon">📖</div><span class="tag">Teach · Passive</span>` |
| 410 | 📖 | `…ue read aloud. Same show as the board's 📖 button, but you pick the words.</p>` |
| 417 | 🧩 | `<div class="icon">🧩</div><span class="tag">Quiz · Active</span>` |
| 426 | 👂 | `<div class="icon">👂</div><span class="tag">Mode 5 · Active</span>` |
| 435 | 🗣 | `<div class="icon">🗣️</div><span class="tag">Mode 6 · Active</span>` |
| 444 | 🎉 | `<div class="icon">🎉</div><span class="tag">Mode 7 · Reward</span>` |
| 453 | ➕ | `…lass="icon" style="background:#fef9c3;">➕</div><span class="tag">Mode 6 · Routine</span>` |
| 455 | → | `… saved routine — e.g. warm-up slideshow → game → celebration.</p>` |
| 466 | 📈 | `<span class="ins-title fred">📈 Fletcher's progress</span>` |
| 483 | 📈 | `…on class="ins-restore" id="ins-restore">📈 Show progress charts</button>` |
| 491 | ▶ | `<!-- SENTENCE ACTIVITY — every ▶ of the sentence builder logs what was said.` |
| 505 | ▶ | `…int" style="margin:10px 4px 8px;">Every ▶ press of the sentence builder — what was said and when. Th…` |
| 520 | 🗣 | `…ngest evidence and are flagged with the 🗣️ icon.</p>` |
| 529 | → | `…w shows the spaced-repetition stage (10 → 50 ceiling) and how many exposures have landed so far. "Ti…` |
| 554 | ↻ | `…nswers-reload" style="margin-top:10px;">↻ Refresh</button>` |
| 559 | 📚 | `<details class="acc"><summary>📚 Words &amp; look</summary>` |
| 600 | ↻ | `… class="btn ghost" id="style-regen-btn">↻ Regenerate style</button>` |
| 633 | 🔊 | `<details class="acc"><summary>🔊 Voice &amp; language</summary>` |
| 643 | ▶ | `…on class="btn ghost" id="voice-preview">▶ Preview</button>` |
| 671 | ✋ | `<details class="acc"><summary>✋ Touch &amp; safety</summary>` |
| 697 | 🙊 | `<span>🙊 Hide bad words in Listening` |
| 703 | 🧩 | `<span>🧩 Listening shows only words with tiles` |
| 719 | ✕ | `…lock;margin:2px 0 0;">Normally the game ✕ needs a 1-second hold so a child can't quit by accident.</…` |
| 728 | ⚠ | `…ze:13px;color:#92400e;font-weight:700;">⚠️ Skip the password on the board's lock?</div>` |
| 746 | 🔘 | `<details class="acc"><summary>🔘 Board tools</summary>` |
| 753 | 🎙 | `<span>🎙 Listening mode <span class="hint" style="display:block;margin:2px 0 0;">Spoken words appear …` |
| 757 | 📖 | `<span>📖 Teach me <span class="hint" style="display:block;margin:2px 0 0;">A teaching slideshow of wh…` |
| 761 | 🙋 | `<span>🙋 Play with me <span class="hint" style="display:block;margin:2px 0 0;">A quick matching game …` |
| 765 | ✏ | `<span>✏️ Sentence builder <span class="hint" style="display:block;margin:2px 0 0;">Tap the pencil, t…` |
| 769 | ✋ | `<span>✋ Drag words to the sentence bar <span class="hint" style="display:block;margin:2px 0 0;">iPad…` |
| 778 | 🧪 | `…ss-only" style="display:none;"><summary>🧪 Access experiments (admin)</summary>` |
| 809 | 🖼 | `<details class="acc"><summary>🖼 Picture album</summary>` |
| 817 | ↻ | `…album-reload" style="margin-left:auto;">↻ Refresh</button>` |
| 825 | 🗂 | `<details class="acc"><summary>🗂 Organize &amp; people</summary>` |
| 841 | ↻ | `…utton class="btn ghost" id="org-reload">↻ Reload</button>` |
| 842 | ✕ | `<button class="btn" id="org-close">✕ Close</button>` |
| 993 | 🌼 | `…strong>yellow flowers bursting</strong> 🌼 across the screen. Celebrations are the only place audio +…` |
| 1013 | ⬇ | `… class="btn primary" id="backup-export">⬇ Download backup (.json)</button>` |
| 1014 | ⬇ | `<button class="btn" id="backup-zip">⬇ Download images &amp; sounds (.zip)</button>` |
| 1025 | 🛟 | `…lass="btn primary" id="support-request">🛟 Request support</button>` |
| 1026 | 🐛 | `<button class="btn" id="support-bug">🐛 Report a bug</button>` |
| 1084 | ⬇ | `…del-backup" style="margin-bottom:12px;">⬇ Download backup first</button>` |
| 1133 | ⭐ | `…width:auto;margin:0;">Board art style — ⭐5 portrait</label>` |
| 1210 | ✨ | `…or:var(--pink-deep);margin-bottom:4px;">✨ Make from a photo</div>` |
| 1216 | ⭐ | `…width:auto;margin:0;">Board art style — ⭐1</label>` |
| 1227 | 📷 | `…ry" id="tile-magic" style="width:100%;">📷 Take a photo &amp; we'll do the rest</button>` |
| 1233 | 🎨⭐ | `…" type="button" style="margin-top:8px;">🎨 Draw a new picture <span style="font-weight:400;">(1st ret…` |
| 1463 | ⭐ | `if (el) el.textContent = '⭐' + d.balance;` |
| 1471 | ⭐ | `return confirm(what + ' uses ⭐' + cost + (bal == null ? '' : ' — you have ⭐' + bal) + '. Continue?')…` |
| 1522 | 🗣🧩🔗📚 | `const ICON = { first_combo: '🗣️', combo: '🧩', chain3: '🔗', words: '📚' };` |
| 1534 | ⭐ | `…"font-size:22px;">' + (ICON[m.kind] \|\| '⭐') + '</div>' +` |
| 1587 | ↑↓ | `: (diff > 0 ? `↑ ${diff} vs last week` : `↓ ${-diff} vs last week`);` |
| 1642 | → | `// No real activity yet (new account) → keep the honest em-dash placeholders` |
| 1703 | 🗣 | `const cg = s.childGeneratedOnly ? ' 🗣️' : '';` |
| 1725 | ✓⚠ | `mastered: '✓ Mastered', eval_flagged: '⚠ Consider eval',` |
| 1742 | → | `…pan style="color:#888;font-size:12px;">(→${p.targetCount})</span>${spacing}</td>` |
| 1781 | ✓ | `mastered: { text: '✓ Mastered',                        bg: '#dcfce7', fg: '#166534' },` |
| 1782 | ↑ | `joint_attention_improving: { text: '↑ Joint attention improving', bg: '#dbeafe', fg: '#1e40af' },` |
| 1784 | ⚠ | `consider_eval: { text: '⚠ Consider evaluation',         bg: '#fee2e2', fg: '#991b1b' },` |
| 1791 | ⚠ | `…:11px;font-weight:700;margin-left:6px;">⚠ Consider evaluation</span>` : '';` |
| 1833 | → | `…th). Uses the session cookie; empty/401 → empty state.` |
| 1861 | 🎨 | `{ kind: 'main',   title: '🎨 Main style',         hint: 'Attached to every new picture.' },` |
| 1862 | 🧑 | `{ kind: 'person', title: '🧑 People & portraits', hint: 'Guides portraits of people.' },` |
| 1863 | 🧸 | `{ kind: 'stuff',  title: '🧸 Objects & scenes',   hint: 'Guides everything that isn\'t a person.' },` |
| 1877 | ⬆ | `…' + c.kind + '" style="font-size:12px;">⬆ Upload your own</button>' +` |
| 1890 | ✓ | `…olor:var(--pink-deep);font-weight:700;">✓ Current style</span>'` |
| 1900 | ✓ | `…olor:var(--pink-deep);font-weight:700;">✓ Current style</span>' +` |
| 1971 | → | `…---- Regenerate the family style (draft → approve) ----` |
| 2024 | ⭐ | `…e new style now? ${rb.credits} credits (⭐1 per word). ` +` |
| 2037 | ✨ | `…yle — they refresh over the next while. ✨`);` |
| 2249 | → | `//   → 'started' \| 'error:<msg>' \| 'nostart' (online but didn't start) \| 'offline'` |
| 2265 | ⚠ | `const NOSTART_MSG = "⚠ The tablet is on the board but didn't start — the chosen categories may not h…` |
| 2266 | ⚠ | `const OFFLINE_MSG = "⚠ " + pretty + "'s tablet isn't on the board right now. Open the app, then tap …` |
| 2318 | ✓ | `… goBtn.textContent = 'Started on tablet ✓'; setTimeout(() => { closeModal(); goBtn.textContent = ori…` |
| 2319 | ⚠ | `…rtsWith('error:')) { sub.textContent = '⚠ ' + res.slice(6); goBtn.textContent = orig; goBtn.disabled…` |
| 2348 | ⏹🎙 | `btn.textContent = on ? '⏹ Stop listening' : '🎙️ Start listening on the tablet';` |
| 2368 | ✓ | `…ast("Started on " + pretty + "'s tablet ✓");` |
| 2369 | ⚠ | `…se if (res.startsWith('error:')) toast('⚠ ' + res.slice(6));` |
| 2384 | ▶ | `…-go" data-run="' + type + ':' + id + '">▶ ' + schEsc(label) + '</button>'` |
| 2385 | ✕ | `…ype + ':' + id + '" aria-label="Delete">✕</button></span>';` |
| 2408 | ✓ | `….textContent = 'Saved as "' + name + '" ✓ — find it under Saved games.';` |
| 2444 | ✕ | `…-rmstep="' + i + '" aria-label="Remove">✕</button></div>';` |
| 2480 | ✓ | `…eRoutineBuilder(); toast('Routine saved ✓');` |
| 2593 | ✅ | `…yId('tile-retry-status').textContent = '✅ Brought back — the swapped-out picture is in Previous pict…` |
| 2618 | 🎨 | `? (d.freeRetry ? '🎨 Redrawing now (free) — the new picture lands in a minute or two.'` |
| 2619 | 🎨⭐ | `: '🎨 Redrawing now (⭐' + (d.charged \|\| 1) + ') — the new picture lands in a minute or two.')` |
| 2665 | ✓ | `statusEl.textContent = 'Photo ready ✓ — tap Save to apply.';` |
| 2667 | 🎨 | `statusEl.textContent = '🎨 Drawing it to match the board…';` |
| 2674 | ✓ | `statusEl.textContent = 'Picture ready ✓ — tap Save to apply.';` |
| 2686 | 📤 | `statusEl.textContent = '📤 Saving the photo…';` |
| 2703 | 📥 | `? '📥 Adding the photo to the board…'` |
| 2704 | 🎨 | `: '🎨 Drawing it to match the board… (1–3 min). You can close this — it lands on its own.';` |
| 2715 | ✅ | `statusEl.textContent = '✅ ' + (job.label \|\| label \|\| 'The tile') + ' is on the board!';` |
| 2724 | ⏳ | `statusEl.textContent = '⏳ Still rendering — it will appear on the board when it finishes.';` |
| 2730 | ✓ | `…-status').textContent = 'Image selected ✓'; }` |
| 2743 | ✓ | `…r.blob(); st.textContent = 'Voice ready ✓';` |
| 2748 | ✓ | `…-status').textContent = 'Sound selected ✓'; } });` |
| 2793 | ✕ | `// confirm copy says so. Quick ✕ in the org tree still works as a shortcut.` |
| 2879 | 👪🧑⚕ | `…--muted);">${m.relation === 'parent' ? '👪 Parent' : '🧑‍⚕️ Therapist'} · joined ${new Date(m.joinedAt…` |
| 2888 | 📨 | `…le="font-size:12px;color:var(--muted);">📨 Invite sent · ${p.hasAccount ? 'they have an account' : 'n…` |
| 2946 | 🧩 | `…ont-size:20px;color:#d6a8c6;flex:none;">🧩</div>';` |
| 2996 | ⭐ | `…sg-add" style="background:#7c3aed;">Add ⭐1</button>'` |
| 3065 | ▶ | `…="' + audio + '" title="Hear the voice">▶</button>' : '')` |
| 3108 | ✅ | `status.textContent = '✅ All set!';` |
| 3155 | ✅🛠 | `(n.kind === 'response' ? '✅ Your request is done' : '🛠 We’re on it') + '</div>' +` |
| 3204 | ✅ | `msg.textContent = '✅ ' + (d.note \|\| "Sent! We'll get back to you within 48 hours.");` |
| 3233 | ⚠ | `…ze:19px;font-weight:800;color:#b45309;">⚠️ ' + problems.length + ' picture' + (problems.length === 1…` |
| 3245 | ⭐ | `: (p.freeRetryUsed ? 'Try again ⭐1' : 'Try again (free)');` |
| 3256 | ✅ | `btn.textContent = r.ok ? '✅ Retrying' : 'Failed (' + r.status + ')';` |
| 3296 | 🪄 | `…ze:19px;font-weight:800;color:#ad1457;">🪄 Your ' + schEsc(f.label) + ' shows up in ' + n + ' other p…` |
| 3297 | ⭐ | `…they show YOUR ' + schEsc(f.label) + '? ⭐1 each — replaced art is archived in the Album.</div>' +` |
| 3304 | ⭐ | `…s="btn" id="fu-regen">Remake ' + n + ' (⭐' + n + ')</button>' +` |
| 3319 | ⭐ | `…target.textContent = 'Remake ' + n + ' (⭐' + n + ')';` |
| 3326 | 🪄 | `…ze:19px;font-weight:800;color:#ad1457;">🪄 “' + schEsc(f.label) + '” is already on the board</div>' +` |
| 3329 | → | `…v style="font-size:20px;color:#6b7280;">→</div>' +` |
| 3448 | → | `// Exact photo → upsert the person, then the free raw tile pipeline` |
| 3463 | → | `// New/changed photo → portrait drawn in the BOARD's saved art style` |
| 3485 | → | `// Details only → upsert the person record (no photo change).` |
| 3542 | → | `// WCAG relative luminance → dark banner gets white text, light gets ink.` |
| 3558 | → | `…ard voice picker (childSettings.voiceId → TTS + every new tile) ----` |
| 3597 | ✓ | `saveSettingsToServer('Voice saved ✓ — new tiles use it right away', 'voice-msg');` |
| 3601 | → | `… Board language (childSettings.language → sync displayLabel + seeded audio) ----` |
| 3609 | ✓ | `saveSettingsToServer('Saved ✓ — the board updates on its next sync', 'lang-msg');` |
| 3628 | ✓ | `saveSettingsToServer('Saved ✓ — the board picks it up on its next settings sync', 'touch-msg');` |
| 3644 | ✓ | `saveSettingsToServer('Saved ✓ — applies on the next settings sync', 'safety-msg');` |
| 3649 | ✓ | `…sToServer('Password protection restored ✓', 'safety-msg');` |
| 3681 | ✓ | `…Server('Password removed for this board ✓', 'safety-msg');` |
| 3705 | ✓ | `saveSettingsToServer('Saved ✓ — the board picks it up on its next settings sync', 'tools-msg');` |
| 3725 | ✓ | `saveSettingsToServer('Saved ✓ — the board picks it up on its next settings sync', 'acc-msg');` |
| 3733 | ✓ | `saveSettingsToServer('Saved ✓ — the board updates within a couple of minutes', 'banner-msg');` |
| 3744 | ✓ | `…g.textContent = r.ok ? (okMsg \|\| 'Saved ✓') : 'Save failed'; setTimeout(() => { msg.textContent = ''…` |
| 3763 | ✓ | `…(msg) { msg.textContent = r.ok ? 'Saved ✓ — syncs to the iPad' : 'Saved on this device only'; setTim…` |
| 3777 | 🎮❓🗣 | `const label = s.type === 'game' ? ('🎮 ' + n + ' game' + (n === 1 ? '' : 's')) : (s.type === 'questio…` |
| 3871 | ✕ | `…ssName = 'btn ghost'; rm.textContent = '✕'; rm.addEventListener('click', () => row.remove());` |
| 3955 | ✓ | `…it saveSettingsToServer('Schedule saved ✓ — syncs to the iPad', 'sched-msg');` |
| 3963 | ✓ | `await saveSettingsToServer('Deleted ✓', 'sched-msg');` |
| 4218 | ✓ | `…ver(grpToggle.checked ? 'Game alerts on ✓' : 'Game alerts off', 'sched-msg');` |
| 4261 | ✎ | `… data-id="' + id + '" aria-label="Edit">✎</button>' +` |
| 4262 | ✕ | `…ata-id="' + id + '" aria-label="Delete">✕</button></span>';` |
| 4289 | ⚠ | `…t:700;color:#b45309;margin-bottom:2px;">⚠️ ' + lost.length + ' lost tile' + (lost.length === 1 ? '' …` |
| 4311 | ↳ | `…⠿</span><span style="margin-right:2px;">↳</span>' + orgThumb(s.imageKey) + '<span style="flex:1;">' …` |
| 4580 | ✓ | `setMsg('Downloaded ✓');` |
| 4684 | ✓ | `setMsg('Downloaded ✓ — ' + files.length + ' files' + (missing ? ' (' + missing + ' media file(s) cou…` |


### `app.html` (142 lines)

| Line | Emoji | Context |
|---:|---|---|
| 24 | → | `Pair with Guided Access (Settings → Accessibility → Guided Access) to actually lock the` |
| 289 | → | `(parent picks color → CSS vars set on :root override these). */` |
| 616 | ✏ | `use the ✏️ pencil. The CI smoke suite asserts this stays true. */` |
| 996 | → | `("Mom" → "Mo/m"). Must live BELOW that rule in the cascade to win. */` |
| 1187 | 🎮 | `<button id="play-btn" class="edit-only">🎮 Play</button>` |
| 1188 | 👪 | `…utton id="parent-btn" class="edit-only">👪 Parent view</button>` |
| 1189 | 🩺 | `…on id="therapist-btn" class="edit-only">🩺 Therapist view</button>` |
| 1190 | ⚙ | `…tton id="display-btn" class="edit-only">⚙ Display</button>` |
| 1192 | 📡 | `… class="edit-only" style="display:none">📡 Remote</button>` |
| 1193 | 🎁 | `… class="edit-only" style="display:none">🎁 Rewards</button>` |
| 1194 | 📁 | `… class="edit-only" style="display:none">📁 Organize</button>` |
| 1195 | ↻ | `…-pull everything fresh from the server">↻ Reload from server</button>` |
| 1202 | 🔒 | `…n-btn" aria-label="Login" title="Login">🔒</button>` |
| 1203 | 🎙 | `…— turn spoken words into picture tiles">🎙️</button>` |
| 1204 | ▶✏ | `…ild a sentence — tap words to add them, ▶ speaks the whole thing">✏️</button>` |
| 1209 | 📖 | `…hes the words you were just looking at">📖</button>` |
| 1210 | 🙋 | `…me about what you were just looking at">🙋</button>` |
| 1217 | ✕ | `…he sentence" title="Clear the sentence">✕</button>` |
| 1218 | ▶ | `…ntence" title="Play the whole sentence">▶</button>` |
| 1274 | 🎨 | `<div class="empty-cta-emoji">🎨</div>` |
| 1278 | ✨ | `…class="btn primary" id="empty-seed-btn">✨ Generate starter words</button>` |
| 1283 | → | `…iew" href="#">Open the parent dashboard →</a></div>` |
| 1286 | 💛 | `…k a grown-up to help set up your board. 💛</p>` |
| 1327 | → | `<!-- AI tile: snap a photo → the durable /api/tile-jobs queue renders it in` |
| 1332 | ✨ | `…t:700;color:#ad1457;margin-bottom:4px;">✨ Make a tile from a photo</div>` |
| 1336 | ⭐ | `…width:auto;margin:0;">Board art style — ⭐1</label>` |
| 1348 | 📷 | `…ght:700;font-size:15px;cursor:pointer;">📷 Take a photo &amp; we'll do the rest</button>` |
| 1391 | 🖼 | `…ld picture is archived, never deleted.">🖼 Adjust framing</button>` |
| 1403 | ✨ | `…ld picture is archived, never deleted.">✨ Match my child's style</button>` |
| 1426 | ⭐ | `…width:auto;margin:0;">Board art style — ⭐1</label>` |
| 1433 | 📍 | `<option value="location">📍 Location (a place — speaks its name, shows its rooms)</option>` |
| 1434 | 🚪 | `<option value="room">🚪 Room (short-press speaks, long-press opens its contents)</option>` |
| 1437 | → | `…that have rooms inside. Example: Places → Home (location) → Kitchen (room) → toaster, fridge…` |
| 1460 | ★ | `…:12px;color:#888;margin-top:6px;">Click ★ on a row to use that image as the category icon (defaults …` |
| 1466 | ✨ | `… style="font-weight:700;color:#ad1457;">✨ How should the pictures look?</div>` |
| 1469 | ⭐ | `…width:auto;margin:0;">Board art style — ⭐1 each</label>` |
| 1473 | ✨ | `…ght:700;font-size:15px;cursor:pointer;">✨ AI: name, pronounce &amp; make art for all</button>` |
| 1532 | 🎨 | `<label style="margin-top:4px;">🎨 Board look</label>` |
| 1590 | 🔘 | `<label style="margin-top:10px;">🔘 Board tools</label>` |
| 1593 | 🎙 | `…l-listen"><label for="disp-tool-listen">🎙 Listening (live word strip)</label>` |
| 1596 | 📖 | `…ool-teach"><label for="disp-tool-teach">📖 Teach (word slideshows)</label>` |
| 1599 | 🙋 | `…-tool-play"><label for="disp-tool-play">🙋 Play (find-the-word game)</label>` |
| 1602 | ✏ | `…ntence"><label for="disp-tool-sentence">✏️ Sentence mode</label>` |
| 1606 | ✋ | `<label style="margin-top:18px;">✋ Touch &amp; play</label>` |
| 1623 | 🎙 | `<label style="margin-top:18px;">🎙 Listening</label>` |
| 1645 | 🔒 | `<label style="margin-top:18px;">🔒 Safety &amp; unlock</label>` |
| 1649 | ✕ | `…ize:12px;color:#666;">Normally the game ✕ needs a hold so a child can't quit by accident.</span></la…` |
| 1661 | ⚠ | `…ze:13px;color:#92400e;font-weight:700;">⚠️ Skip the password on the board's lock?</div>` |
| 1699 | 📱 | `<label style="margin-top:18px;">📱 This device</label>` |
| 1738 | ⚙ | `…t time. You can change this later under ⚙ Display.</div>` |
| 1740 | 🧒 | `…ht:600;cursor:pointer;text-align:left;">🧒 <span class="cn">Your child</span> — the communication boa…` |
| 1741 | 👪 | `…ht:600;cursor:pointer;text-align:left;">👪 Parent — the dashboard</button>` |
| 1742 | 🩺 | `…ht:600;cursor:pointer;text-align:left;">🩺 Therapist — the facilitator view</button>` |
| 1749 | 📁 | `<h2>📁 Organize</h2>` |
| 1814 | 🎁 | `<h3>🎁 Rewards &amp; music</h3>` |
| 1824 | ▶ | `…on" class="secondary" id="rewards-test">▶ Test a cheer</button></div>` |
| 1837 | 🔊 | `…btn" id="game-prompt"><span class="spk">🔊</span><span id="game-prompt-label">Listen</span></button>` |
| 1838 | ✕ | `…it" id="game-exit" title="Hold to exit">✕</button>` |
| 1857 | → | `… from the URL (e.g. /u/fletcherpeterson → "fletcherpeterson").` |
| 2096 | 🙋 | `// survives reloads) so the 🙋 play button can quiz exactly what they were` |
| 2355 | → | `…rd whose custom render is still queued) →` |
| 2369 | ★ | `pin.textContent = '★';` |
| 2375 | ✎ | `eb.textContent = '✎';` |
| 2522 | → | `… test: pointer past the target's center → land AFTER it.` |
| 2559 | → | `// Same sibling group → the shuffle IS the preview; no outline needed.` |
| 2603 | ✎ | `… (el.textContent \|\| '').trim().replace(/✎/g, '').slice(0, 24) \|\| 'Moving…';` |
| 2657 | → | `…        // touch: moved before the hold → it's a scroll` |
| 2883 | ✎ | `eb.textContent = '✎';` |
| 2917 | ✨ | `styleFolder.textContent = '✨ Style';` |
| 2926 | ✓ | `…der already matches your child's style. ✓"); return; }` |
| 2927 | ⭐ | `…n this folder to your child's style for ⭐${q.cost}?\n\nAlready-styled pictures are skipped — you're …` |
| 3121 | → | `… return;   // already used this session → already blessed` |
| 3140 | ✕ | `…e device): a capable kid gets quick-tap ✕ and password-free unlock` |
| 3142 | → | `// (Board → Touch & safety) or this board's Display modal.` |
| 3143 | ✕ | `//   easyClose   — game ✕ closes on a quick tap instead of the hold.` |
| 3190 | ▶ | `// sbStage. Speaking waits for ▶.` |
| 3207 | → | `// every fact heard → fall through: speak the word, restart the chain` |
| 3309 | 🔓🔒 | `lb.textContent = on ? '🔓' : '🔒';` |
| 3328 | ✋ | `h.textContent = '✋ Hold a tile until it lifts, then drag it onto another tile to reorder — or onto a…` |
| 3350 | → | `// Editor role → re-enter the account password (still guards against a kid` |
| 3351 | → | `…ding into edit mode). No session at all → fall back to the admin token.` |
| 3494 | → | `…s the last-known answer; null = unknown → permissive` |
| 3531 | 🧩 | `+ '<div style="font-size:40px;">🧩</div>'` |
| 3568 | ⭐ | `return confirm(what + ' uses ⭐' + cost + (bal == null ? '' : ' — you have ⭐' + bal) + '. Continue?')…` |
| 3576 | ✨ | `+ '<div style="font-size:40px;">✨</div>'` |
| 3604 | 🎉 | `…elcome to My World on your Fire tablet! 🎉';` |
| 3609 | 🎉 | `…itle = 'Welcome to My World on Android! 🎉';` |
| 3626 | 📱 | `+ '<div style="font-size:40px;">📱</div>'` |
| 3740 | → | `…cheAllMedia(); return; }   // unchanged → just keep media warm (retries failures)` |
| 3995 | ✓ | `histMsg.textContent = '✓ Restored';` |
| 4000 | ✗ | `histMsg.textContent = '✗ ' + (err.message \|\| err);` |
| 4041 | → | `// childId → the server speaks in the BOARD's chosen voice; without it` |
| 4071 | → | `// ---- AI tile: photo → the durable tile-jobs queue (matches the native` |
| 4100 | 📤 | `statusEl.textContent = '📤 Saving the photo…';` |
| 4119 | 📥🌍 | `? '📥 Adding the photo to the board… Don’t worry — it’s saved; a 🌍 Pending tile marks the spot.'` |
| 4120 | 🎨🌍 | `: '🎨 Drawing it to match the board… This takes a few minutes — don’t worry. Your photo is saved; you…` |
| 4135 | ✅ | `statusEl.textContent = '✅ ' + (job.label \|\| label \|\| 'The tile') + ' is on the board!';` |
| 4144 | ⏳ | `statusEl.textContent = '⏳ Still rendering — it will appear on the board when it finishes.';` |
| 4195 | → | `…e math anchors on (base·z) = natural px → stage px, so the saved square` |
| 4280 | ✓ | `…item-frame-note').textContent = 'Framed ✓ — the old picture is in Previous pictures.';` |
| 4360 | ⭐ | `…etry ? 'Redrawing (free)' : 'Redrawing (⭐' + r.charged + ')')` |
| 4468 | → | `} catch (_) { /* generation hiccup → keep the exact photo */ }` |
| 4564 | ★☆ | `….textContent = idx === bulkIconIndex ? '★' : '☆';` |
| 4590 | ✕ | `rm.textContent = '✕';` |
| 4688 | ✨ | `// ✨ One-tap: for every photo, suggest a name + pronunciation and (optionally)` |
| 4727 | ✅ | `prog.textContent = '✅ AI done — review the names and Save.';` |
| 5027 | ↻ | `…btn.disabled = true; btn.textContent = '↻ Reloading…'; }` |
| 5539 | → | `…ers). Its tiles are in the Items column → — drag to reorder.'` |
| 5730 | → | `// Cross kind: item onto cat → move into that cat (append)` |
| 5738 | → | `// Cross kind: cat onto section row → promote to top-level of section` |
| 5938 | ▶ | `…eElement('button'); play.textContent = '▶ Play'; play.style.cssText = 'border:none;border-radius:999…` |
| 5992 | → | `// no picture configured → borrow the child's own tile for this word` |
| 6085 | 🎉 | `ph.textContent = '🎉';` |
| 6468 | 🌼 | `….className = 'flower'; f.textContent = '🌼';` |
| 6503 | → | `… routineNext();   // game step finished → next routine step` |
| 6505 | → | `…elockAfterActivity(); }   // fully done → idle + re-lock the board` |
| 6523 | ✕ | `…or:#fff;font-size:24px;cursor:pointer;">✕</button>';` |
| 6558 | → | `… routineNext();   // time limit reached → next step` |
| 6559 | → | `…ty(); }   // standalone slideshow ended → re-lock` |
| 6568 | → | `…st teachTTS = new Map();   // clue text → object URL (session cache; /api/tts caches server-side)` |
| 6604 | ✕ | `…#ad1457;font-size:24px;cursor:pointer;">✕</button>';` |
| 6653 | ✕ | `…otent — the loop calls this again after ✕` |
| 6676 | → | `… Routines — chain modes (e.g. slideshow → game → celebration) in order =====` |
| 6705 | ↔ | `…--- Facilitated mode: phone (therapist) ↔ tablet over /api/live ----` |
| 6913 | 💡 | `…ze:19px;font-weight:700;color:#ad1457;">💡 Suggest new words from listening?</div>'` |
| 7011 | → | `// requiresOnDeviceRecognition → Apple's offline on-device engine (no network).` |
| 7032 | → | `… bumpListenIdle();   // heard something → reset the 2-min timeout` |
| 7068 | ⏹🎙 | `…oggle('on', on); lb.textContent = on ? '⏹️' : '🎙️'; lb.title = on ? 'Stop listening' : 'Listen — tur…` |
| 7109 | ✕ | `// countdown a grown-up can ✕ to skip; on fire, every batch slug is ticked` |
| 7151 | ✕ | `…#ad1457;font-size:18px;cursor:pointer;">✕</button>'` |
| 7152 | 📚 | `+ '<div style="font-size:52px;">📚</div>'` |
| 7199 | → | `…// back-compat: therapist sends no mode → facilitated` |
| 7291 | 🙋 | `// The child's 🙋 button is a SELF-LEARNING button: it instantly starts a` |
| 7308 | 📖 | `// 📖 Teach me — teaching slideshow of the same last-pressed scope.` |
| 7422 | → | `// kids who naturally repeat). Absent → legacy flag decides at 2.` |
| 7494 | ⬅⬆ | `const prev = d.axis === 'x' ? mk(-1, '⬅', 'Previous page') : mk(-1, '⬆', 'Page up');` |
| 7495 | ➡⬇ | `const next = d.axis === 'x' ? mk(1, '➡', 'Next page') : mk(1, '⬇', 'Page down');` |
| 7507 | ✏ | `// MODAL, not gestural (the pencil ✏️ in the header owns it): while sentence` |
| 7510 | ▶✕ | `// (▶ says the sentence, ✕ clears). The mode turns itself off after 60s if` |
| 7564 | ▶ | `… null, null);   // logged, not spoken — ▶ does the talking` |
| 7568 | ✕ | `// Playback carries a generation token: ✕, pencil-off, listening, and games` |
| 7569 | ▶ | `… it, which aborts the loop AND a second ▶ can never stack a` |


### `onboard.html` (77 lines)

| Line | Emoji | Context |
|---:|---|---|
| 140 | ▶ | `…ild hears whenever they tap a tile. Tap ▶ to hear a sample. Voices are synthetic, generated by our s…` |
| 147 | → | `…" id="style-continue" disabled>Continue →</button>` |
| 152 | ← | `…eople-back" style="margin-bottom:10px;">← Back to style</button>` |
| 161 | ✓ | `… class="btn ok tiny" id="child-approve">✓ Looks great</button>` |
| 162 | ↻ | `…class="btn ghost tiny" id="child-retry">↻ Try again</button>` |
| 170 | ✓ | `…class="btn ok tiny" id="parent-approve">✓ Looks great</button>` |
| 171 | ↻ | `…lass="btn ghost tiny" id="parent-retry">↻ Try again</button>` |
| 191 | 📷 | `…:700;font-size:14px;text-align:center;">📷 Tap to add a photo</div>` |
| 203 | → | `…abled style="margin-top:14px;">Continue →</button>` |
| 208 | ← | `…scene-back" style="margin-bottom:10px;">← Back to people</button>` |
| 215 | ✓ | `…ss="btn ok" id="scene-approve" disabled>✓ Build the board with this look</button>` |
| 216 | ↻ | `…s="btn ghost" id="scene-retry" disabled>↻ Try again</button>` |
| 248 | → | `server-side (keys from seed-core status → recentImages). -->` |
| 276 | ⭐ | `favorites. Foods + toys each carry a ⭐3 gift (granted when the card` |
| 285 | 💛⭐ | `💛 An honest note about credits: building the board uses most of your first month's ⭐ —` |
| 289 | 🍕 | `… style="font-size:15px;margin:0 0 4px;">🍕 Favorite foods <span id="fav-foods-gift" style="background…` |
| 291 | ⭐ | `…ld-name">your child</span>'s art style (⭐1 of your gift) and lands in the board's Food folder on its…` |
| 294 | 📸 | `<button class="btn" id="fav-foods-add">📸 Add food photos</button>` |
| 295 | → | `…ss="btn ghost" id="fav-foods-next">Next →</button>` |
| 302 | 🧸 | `… style="font-size:15px;margin:0 0 4px;">🧸 Favorite toys <span id="fav-toys-gift" style="background:#…` |
| 304 | ⭐ | `(⭐1 of your gift each), straight into the Toys folder.</p>` |
| 307 | 📸 | `<button class="btn" id="fav-toys-add">📸 Add toy photos</button>` |
| 308 | → | `…ass="btn ghost" id="fav-toys-next">Next →</button>` |
| 315 | 🎬 | `… style="font-size:15px;margin:0 0 4px;">🎬 Favorite shows &amp; movies</h4>` |
| 321 | 🖼 | `<button class="btn" id="fav-shows-add">🖼 Add from my photos</button>` |
| 322 | ✓ | `…ss="btn ghost" id="fav-shows-next">Done ✓</button>` |
| 330 | 🎉 | `<div style="font-size:40px;">🎉</div>` |
| 345 | 🧒 | `choose "🧒 — the communication board" when it asks who uses the device, and (on iPad) turn on` |
| 346 | → | `…strong>Guided Access</strong> (Settings → Accessibility) so the tablet stays a talker.` |
| 357 | 🔒→⚙ | `under 🔒 → ⚙ Display on the board itself. -->` |
| 361 | 🔒→⚙ | `…ged later on the board: tap the <strong>🔒 lock → ⚙ Display settings</strong>.</p>` |
| 377 | ✓🔒→⚙ | `… id="bw-finished" style="display:none;">✓ Board behavior saved — change any of these anytime on the …` |
| 413 | → | `…class="btn" id="at-sched-next">Continue →</button>` |
| 414 | ← | `…ass="btn ghost tiny" id="at-back-intro">← Back</button>` |
| 438 | ✓ | `…btn ok" id="at-save">Turn on Auto-Teach ✓</button>` |
| 439 | ← | `…ass="btn ghost tiny" id="at-back-sched">← Back</button>` |
| 444 | ✓ | `…7857;font-weight:600;">Auto-Teach is on ✓ — slideshows and the daily game will start on the board to…` |
| 450 | → | `<li>Settings → Accessibility → <strong>Guided Access</strong> → turn on, set a passcode.</li>` |
| 452 | → | `<li>Settings → Display &amp; Brightness → <strong>Auto-Lock → Never</strong> so the board stays awak…` |
| 456 | → | `<li>Settings → Security &amp; privacy → <strong>App pinning</strong> (sometimes under "More security…` |
| 457 | → | `…World, open Recents, tap the app's icon → <strong>Pin</strong>.</li>` |
| 458 | → | `<li>Settings → Display → <strong>Screen timeout</strong> → the longest setting.</li>` |
| 463 | ✓ | `… id="at-finished" style="display:none;">✓ Auto-Teach setup finished — manage it anytime in the paren…` |
| 584 | ⭐ | `// Foods + toys each grant ⭐3 the moment their card unlocks (idempotent —` |
| 630 | ⭐ | `(d.granted ? '⭐3 added — ' : '') + 'you have ⭐' + d.balance;` |
| 640 | ✓ | `else $('fav-shows-msg').textContent = '✓ All set — everything you added lands on the board on its ow…` |
| 651 | 📤 | `msg.textContent = '📤 Saving photo ' + (FAV.added[step] + 1) + '…';` |
| 666 | ⭐ | `msg.textContent = 'Out of ⭐ — check "use my exact photos" (free) and try again.';` |
| 673 | ✓ | `msg.textContent = '✓ ' + FAV.added[step] + ' of ' + cfg.max + ' saved — '` |
| 738 | ↗ | `pv.textContent = 'See a whole board ↗';` |
| 746 | ⬆ | `…'<div class="pic" id="style-upload-pic">⬆️</div><div class="lbl">Upload your own</div>';` |
| 866 | ▶ | `…iny voice-play" style="margin-top:8px;">▶ Sample</button>';` |
| 872 | ▶ | `…{ audio.pause(); playBtn.textContent = '▶ Sample'; playingFor = null; return; }` |
| 873 | ▶ | `…ce-play').forEach(b => b.textContent = '▶ Sample');` |
| 880 | ⏸ | `…ayingFor = v.id; playBtn.textContent = '⏸ Stop';` |
| 881 | ▶ | `…nended = () => { playBtn.textContent = '▶ Sample'; playingFor = null; };` |
| 882 | ▶ | `…message \|\| err); playBtn.textContent = '▶ Sample'; }` |
| 911 | ✓ | `$('child-thumb').innerHTML = '✓';` |
| 1004 | ✓ | `? 'Both saved ✓ — add more family, or continue.'` |
| 1005 | ✓ | `: (childDone ? name + ' saved ✓ — now upload a photo of one grown-up.'` |
| 1006 | ✓ | `: name + ' saved ✓ — now upload a photo of your child.');` |
| 1030 | 📷 | `… = null; $('famx-thumb').textContent = '📷 Tap to add a photo'; $('famx-msg').textContent = '';` |
| 1113 | → | `// around the founder letter: left rail → right rail → bottom strip.` |
| 1262 | ✕ | `…#9ca3af;font-size:16px;cursor:pointer;">✕</button>' +` |
| 1374 | 🎓 | `{ label: '🎓 Still learning meanings — turn on Tap again to learn', save: { doubleTapTeach: true } },` |
| 1375 | 🗣 | `{ label: '🗣 They know their words — keep taps simple', save: { doubleTapTeach: false } },` |
| 1382 | 🌊 | `{ label: '🌊 Let each word finish', save: { tapInterrupt: false } },` |
| 1383 | ⚡ | `{ label: '⚡ The new tap wins — talk right away', save: { tapInterrupt: true } },` |
| 1388 | ✏ | `body: 'The ✏️ sentence builder in the board header lets a child stage several tiles and play them ba…` |
| 1390 | ✏ | `{ label: '✏️ Yes — show the sentence builder', save: { toolSentence: true } },` |
| 1391 | 🔤 | `{ label: '🔤 Single words for now — hide it', save: { toolSentence: false } },` |
| 1398 | 👂 | `{ label: '👂 Keep Listening mode', save: { toolListen: true } },` |
| 1399 | 🙈 | `{ label: '🙈 Hide it for now', save: { toolListen: false } },` |
| 1403 | ✕ | `title: () => 'How should the ✕ close button work in games and slideshows?',` |
| 1406 | 🛡 | `{ label: '🛡 Hold to close (kid-proof)', save: { easyClose: false } },` |
| 1407 | ⚡ | `{ label: '⚡ Quick tap closes right away', save: { easyClose: true } },` |
| 1460 | 🔒→⚙ | `…he same choices live on the board under 🔒 → ⚙ Display settings, with plain-language explanations.';` |


### `store.html` (30 lines)

| Line | Emoji | Context |
|---:|---|---|
| 72 | 🛍 | `<h1>🛍️ Word Store</h1>` |
| 73 | ⭐ | `<span class="balance" id="balance">⭐ …</span>` |
| 75 | ← | `<a class="back" id="back-link" href="#">← Dashboard</a>` |
| 78 | 💛 | `<div class="promise">💛 <span><b>Every image you make is your family's to keep.</b> Images are stored…` |
| 140 | ⭐ | `…then packs stack on top of your monthly ⭐.</div>`;` |
| 145 | ⭐ | `<div class="big">⭐ ${p.credits}</div>` |
| 157 | ⭐ | `…our whole starter board personalized (a ⭐120+ value) · speech-to-text · auto-teach · reporting',` |
| 158 | ⭐ | `…thly':     'same enrollment build — and ⭐50 still yours after sign-up · biggest voice budget · new f…` |
| 163 | ⭐ | `… board usually uses most of month one’s ⭐ — they refresh every month.',` |
| 168 | ⭐ | `<div class="big">⭐ ${s.creditsPerPeriod}<span style="font-size:13px;font-weight:600;color:var(--mute…` |
| 170 | 💛 | `…us:8px;padding:6px 8px;margin-top:6px;">💛 ${esc(HONEST[s.sku])}</div>` : ''}` |
| 180 | ⭐ | `<div class="big">⭐ ${c.rebuild.credits}</div>` |
| 181 | ⭐ | `…ade in your child's style, in one tap — ⭐1 per word, same as one-by-one</div>` |
| 270 | ✓ | `<div class="pick">${CART.has(t.id) ? '✓' : ''}</div>` |
| 271 | ⭐ | `<div class="cap">${esc(t.label)} · ⭐${t.credits}</div>` |
| 295 | ⭐ | `…ze} word${CART.size === 1 ? '' : 's'} · ⭐${CART.size} — made in your child's style + voice`;` |
| 301 | ⭐ | `…} word${CART.size === 1 ? '' : 's'} for ⭐${CART.size}? You have ⭐${CATALOG ? CATALOG.balance : '…'}.…` |
| 316 | ⭐ | `…etElementById('balance').textContent = `⭐ ${CATALOG.balance} credits`;` |
| 326 | ⭐ | `….textContent = `${TILES.length} words · ⭐1 each, drawn in your child's style`;` |
| 331 | ⭐ | `// ── Personalization status: "⭐N to finish" per folder + finish buttons.` |
| 342 | ✨ | `let html = '<div class="group-title">✨ Personalize your board <span style="font-weight:400;color:var…` |
| 347 | ⭐ | `…999px;padding:4px 12px;font-size:13px;">⭐${f.cost} to finish</span>` |
| 348 | ✨ | `…ds tiles personalize one by one"' : ''}>✨ Finish</button>` |
| 355 | ⭐ | `… === '1' ? '' : 's'} in this folder for ⭐${b.dataset.cost}? You have ⭐${CATALOG ? CATALOG.balance : …` |
| 382 | 🧩 | `let html = '<div class="group-title">🧩 Add-on boards <span style="font-weight:400;color:var(--muted)…` |
| 418 | ⭐ | `toast(`⭐${d.credited} added — enjoy!`);` |
| 427 | ⭐ | `…ment received — your credits are ready! ⭐');` |
| 434 | ⭐ | `…0+ core words + two family portraits, a ⭐120+ value),` |
| 436 | ⭐ | `…lways finishes enrollment with at least ⭐50 remaining. Cancel anytime: everything you've made stays …` |
| 437 | ⭐ | `…mberships — My World Plus ($9.99/month, ⭐50 monthly) and Pro ($19.99/month, ⭐150) — renew` |


### `practice.html` (25 lines)

| Line | Emoji | Context |
|---:|---|---|
| 86 | ⚙ | `/* Session-only display prefs (the ⚙ Display modal): hiding labels mirrors` |
| 157 | → | `…ref="/signup.html">Make it your child's →</a>` |
| 172 | ⚙ | `…tions and colors — just for this visit">⚙ Display</button>` |
| 173 | 🎙 | `…nd the words you say light up as tiles">🎙 Try listening</button>` |
| 174 | ✨ | `…s mean and everything you can try here">✨ What's personalized?</button>` |
| 178 | → | `…="/signup.html">Create your child's own →</a></span>` |
| 195 | ⚙ | `<!-- ⚙ Display — the real board's most-used look controls, so a parent can` |
| 200 | ⚙ | `<h3>⚙ Display</h3>` |
| 234 | 👋 | `<h3>👋 This is the board — here's what becomes <i>your child's</i></h3>` |
| 242 | 📷 | `<li>📷 <b>Always free:</b> unlimited tiles from your exact photos, the whole starter` |
| 244 | 🤝 | `<li>🤝 <b>Try it with a safety net:</b> joining builds the full board up front so you` |
| 249 | 🎙⚙ | `tap <b>🎙 Try listening</b> and just talk, and open <b>⚙ Display</b> to reshape the board.` |
| 252 | → | `…ref="/signup.html">Make it your child's →</a>` |
| 262 | 🎙 | `<h3 id="lh-title">🎙 Listening</h3>` |
| 268 | ↻ | `…ip" id="lh-retry" style="display:none;">↻ Try again</button>` |
| 287 | ⚙ | `// ── ⚙ Display prefs — SESSION-ONLY by design ─────────────────────────────` |
| 296 | ⚙ | `…ith imagery; every control below is one ⚙ tap away.` |
| 454 | → | `…nd-in line. Clip missing (older builds) → stay silent; the` |
| 551 | ⚙ | `// ── ⚙ Display panel wiring ────────────────────────────────────────────────` |
| 694 | 🎙 | `title.textContent = '🎙 Listening needs a supported browser';` |
| 701 | 🎙 | `title.textContent = '🎙 The microphone is blocked';` |
| 702 | 🔒🎤 | `…tContent = 'To try listening: click the 🔒 (or 🎤) icon next to the web address, '` |
| 714 | ▶ | `if (b) b.textContent = '▶ Try listening';` |
| 754 | 🎙 | `if (b) b.textContent = '🎙 Listening… ' + left + 's';` |
| 772 | ✨ | `// from the ✨ button.` |


### `therapist.html` (21 lines)

| Line | Emoji | Context |
|---:|---|---|
| 181 | 📈 | `<span class="ins-title fred">📈 Fletcher's progress</span>` |
| 198 | 📈 | `…on class="ins-restore" id="ins-restore">📈 Show progress charts</button>` |
| 205 | 🎯 | `<div class="thumb" id="live-thumb">🎯</div>` |
| 211 | 👆 | `…ark" data-method="tap"><span class="ic">👆</span>Tapped it</button>` |
| 212 | 🗣 | `…" data-method="verbal"><span class="ic">🗣️</span>Said it</button>` |
| 213 | 🧸 | `…" data-method="object"><span class="ic">🧸</span>Showed object</button>` |
| 217 | → | `…on class="ctl next" id="live-next">Next →</button>` |
| 239 | ✓ | `… class="q-item done"><span class="q-ic">✓</span> ear <span class="via tap">tapped</span></div>` |
| 240 | ✓ | `… class="q-item done"><span class="q-ic">✓</span> hand <span class="via object">object</span></div>` |
| 241 | ✓ | `… class="q-item done"><span class="q-ic">✓</span> foot <span class="via verbal">said it</span></div>` |
| 242 | ✓ | `… class="q-item done"><span class="q-ic">✓</span> eye <span class="via tap">tapped</span></div>` |
| 243 | ✓ | `… class="q-item done"><span class="q-ic">✓</span> mouth <span class="via verbal">said it</span></div>` |
| 244 | ↪ | `… class="q-item done"><span class="q-ic">↪</span> knee <span class="via">skipped</span></div>` |
| 305 | → | `…#" id="to-parent">Open parent dashboard →</a></div>` |
| 396 | → | `…th). Uses the session cookie; empty/401 → empty state.` |
| 425 | → | `…litator control (polls /api/live; phone → tablet over the cloud) ----` |
| 449 | 🎉 | `…tent = d.status === 'ended' ? 'finished 🎉' : 'on screen now';` |
| 452 | 🎯 | `: '🎯';` |
| 455 | 🎯 | `… 'waiting to start'; thumb.innerHTML = '🎯';` |
| 458 | 🎯 | `…ent = 'not started'; thumb.innerHTML = '🎯';` |
| 459 | 📡 | `prog.textContent = 'On the tablet, tap 📡 Remote (edit mode), then Start here.';` |


### `index.html` (10 lines)

| Line | Emoji | Context |
|---:|---|---|
| 183 | ✓ | `content: '✓'; position: absolute; left: 0; top: 8px;` |
| 255 | 🧩 | `… class="btn secondary" href="/practice">🧩 Try the board live</a>` |
| 259 | → | `…n">Sign in to set up your child's board →</a></p>` |
| 297 | → | `…href="/practice">See a whole board live →</a></p>` |
| 382 | 🙋 | `<p class="lead">The 🙋 button starts a short, self-paced quiz about whatever your child was just expl…` |
| 415 | ⭐ | `… 100+ tiles and two family portraits, a ⭐120+ value on your first ⭐50</li>` |
| 416 | ⭐ | `<li>⭐50 image credits every month after</li>` |
| 424 | ⭐ | `…gift</b> — plus you finish sign-up with ⭐50 still to spend</li>` |
| 425 | ⭐ | `<li>⭐150 image credits every month</li>` |
| 540 | 🌍 | `…your invite code as soon as spots open. 🌍";` |


### `signup.html` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 56 | → | `… <a href="/#waitlist">Join the waitlist →</a></p>` |
| 65 | → | `…"signup-btn">Create account &amp; start →</button>` |
| 109 | → | `…account.') + ' <a href="/login">Sign in →</a>';` |
| 112 | → | `… <a href="/#waitlist">Join the waitlist →</a>';` |
| 119 | → | `… <a href="/#waitlist">Join the waitlist →</a>';` |


### `welcome.html` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 43 | → | `<button type="submit" id="go">Enter →</button>` |
| 48 | → | `… is? <a href="/">See how My World works →</a></p>` |


### `privacy.html` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 24 | ← | `<header><a href="/">← My World</a></header>` |
| 71 | → | `…nAI</td><td>AI image generation (photos → illustrated tiles)</td></tr>` |


### `terms.html` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 24 | ← | `<header><a href="/">← My World</a></header>` |


## 2 · Native apps (iOS + Android) — 490 lines across 100 files


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/ParentHomeView.kt` (25 lines)

| Line | Emoji | Context |
|---:|---|---|
| 115 | ⭐ | `Triple("store", "⭐", "Credits & Store"),` |
| 116 | 📷 | `Triple("addtile", "📷", "Add a tile"),` |
| 117 | 💬 | `Triple("message", "💬", "Message the board"),` |
| 118 | 🗂 | `Triple("quickboard", "🗂", "Quick board"),` |
| 121 | 🎙 | `Triple("listening", "🎙", "Listening mode"),` |
| 122 | 🎯 | `Triple("game", "🎯", "Start a game"),` |
| 123 | 📊 | `Triple("stats", "📊", "Stats"),` |
| 124 | ⏰ | `Triple("schedules", "⏰", "Schedules"),` |
| 125 | 🖼 | `Triple("album", "🖼", "Album"),` |
| 126 | 📚 | `Triple("autoteach", "📚", "Auto-teach"),` |
| 135 | 🌍 | `Text("🌍", fontSize = 22.sp)` |
| 146 | ⚙ | `) { Text("⚙", fontSize = 19.sp) }` |
| 149 | 🛠✅ | `// 🛠/✅ Support notices — the team opened the board (with the family's` |
| 159 | ✅🛠 | `Text(if (n.kind == "response") "✅ Your request is done" else "🛠 We're on it",` |
| 173 | ⚠ | `// ⚠️ Pictures that failed every render attempt — the parent's alert` |
| 185 | ⚠ | `Text("⚠️ ${problems.size} picture${if (problems.size == 1) "" else "s"} didn't finish",` |
| 209 | ⭐ | `…if (p.freeRetryUsed == true) "Try again ⭐1" else "Try again (free)",` |
| 239 | ⭐ | `"⭐ $bal", fontSize = 13.sp, fontWeight = FontWeight.Black,` |
| 291 | ✕ | `… — the SAME BoardView full-screen, hold-✕ exits. */` |
| 525 | → | `… use Android's screen pinning: Settings → Security → " +` |
| 526 | → | `"App pinning (on Fire: Settings → Security & Privacy), turn it on, open the " +` |
| 545 | 🛟 | `Text("🛟 Request support…", color = Brand.pinkDeep)` |
| 550 | 🐛 | `Text("🐛 Report a bug…", color = Brand.pinkDeep)` |
| 787 | ✓ | `if (s.id == currentId) Text("✓", fontSize = 16.sp, color = Brand.pinkDeep)` |
| 859 | → | `/** Vocabulary band ids → parent-friendly labels (ParentHomeView.swift parity). */` |


### `kid-ios/MyWorld/Parent/OnboardingFlow.swift` (25 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `/// top-to-bottom: Demo → Account → Child → Child photo → Parent photo →` |
| 9 | → | `/// Seed Core → Done. Each screen is a small struct; the OnboardingCoordinator` |
| 226 | ▶ | `/// Each chip has a ▶ that auditions the voice from its preview sample.` |
| 243 | ▶ | `Text("How the board talks — tap ▶ to hear each voice.")` |
| 614 | → | `// Brand-new account → continue onboarding; existing → straight` |
| 630 | → | `…ated: false)        // existing account → no onboarding` |
| 658 | → | `…h(created: true)         // new account → onboarding continues` |
| 762 | → | `// Favorite color → the banner color everywhere (§1); the server` |
| 1344 | ⭐ | `…ersonalized up front (Pro finishes with ⭐50 to spare). Without a membership the board starts with ou…` |
| 1373 | ⚙ | `/// live under ⚙ Display settings afterwards.` |
| 1395 | 🎓 | `Choice(label: "🎓 Still learning meanings — turn on Tap again to learn", key: "doubleTapTeach", value…` |
| 1396 | 🗣 | `Choice(label: "🗣 They know their words — keep taps simple", key: "doubleTapTeach", value: false),` |
| 1402 | 🌊 | `Choice(label: "🌊 Let each word finish", key: "tapInterrupt", value: false),` |
| 1403 | ⚡ | `Choice(label: "⚡ The new tap wins — talk right away", key: "tapInterrupt", value: true),` |
| 1407 | ✏ | `body: "The ✏️ sentence builder in the board header lets a child stage several tiles and play them ba…` |
| 1409 | ✏ | `Choice(label: "✏️ Yes — show the sentence builder", key: "toolSentence", value: true),` |
| 1410 | 🔤 | `Choice(label: "🔤 Single words for now — hide it", key: "toolSentence", value: false),` |
| 1416 | 👂 | `Choice(label: "👂 Keep Listening mode", key: "toolListen", value: true),` |
| 1417 | 🙈 | `Choice(label: "🙈 Hide it for now", key: "toolListen", value: false),` |
| 1420 | ✕ | `title: "How should the ✕ close button work in games and slideshows?",` |
| 1423 | 🛡 | `Choice(label: "🛡 Hold to close (kid-proof)", key: "easyClose", value: false),` |
| 1424 | ⚡ | `Choice(label: "⚡ Quick tap closes right away", key: "easyClose", value: true),` |
| 1432 | ⚙ | `…("No problem — the same choices live in ⚙ Display settings, with the same plain-language explanation…` |
| 1439 | ⚙ | `…. Everything can be changed later under ⚙ Display settings.")` |
| 1493 | ⚙ | `…ved — change any of these anytime under ⚙ Display settings.",` |


### `kid-ios/MyWorld/Views/AddTileView.swift` (23 lines)

| Line | Emoji | Context |
|---:|---|---|
| 16 | 🖼 | `///   │  Which folder?  [🖼 Food] [🖼 Toys] …  (required for columns)│` |
| 18 | 📷🖼 | `///   │  [ 📷 Take a photo ]   [ 🖼 Choose from Photos ]            │` |
| 20 | 🔊 | `///   │  [photo] Banana          🔊 Making the voice…       ◔       │` |
| 21 | ✓ | `///   │  [photo] On the board ✓  tap to rename               ✓      │` |
| 34 | → | `// Section → Folder → Sub-folder and the camera stays locked until the` |
| 47 | → | `…odel is auto-routed server-side (people → GPT keystone, things → nano` |
| 175 | ⭐ | `… new style afterward in the Word Store (⭐1 per word).")` |
| 189 | → | `magic = nil   // dismissal → onDismiss advances the queue` |
| 291 | ⭐ | `…(section == .people ? "Drawn to match — ⭐5 portrait" : "Drawn to match — ⭐1")` |
| 402 | → | `// → a single tile; several → a reviewable batch.` |
| 477 | → | `// Done → rename; needs-a-name → name it. (Error cards use their button.)` |
| 485 | → | `…gle photo (camera, or one library pick) → one tile, no review flag.` |
| 505 | → | `/// one photo → a single tile (no review); several → a reviewable batch.` |
| 518 | → | `// Single pick → same "hold on, here's more info" review as a snap.` |
| 744 | → | `///   • Override the name (leave blank → the AI auto-labels it), and` |
| 755 | ⭐ | `/// ⭐5 keystone portrait, everything else ⭐1). Server-enforced regardless.` |
| 828 | ✨ | `(Text("✨ Want this drawn in your child's art style? ")` |
| 847 | ⭐ | `…ton(useAsIs ? "Add photo" : "Generate · ⭐\(styledCost)") {` |
| 861 | ⭐ | `.alert("Use ⭐\(styledCost)?", isPresented: $confirmSpend) {` |
| 865 | ⭐ | `…wing this in the board's art style uses ⭐\(styledCost). \u{201C}Use my photo as-is\u{201D} is free."…` |
| 1022 | ⭐ | `…m so they show YOUR \(candidate.label)? ⭐1 each — replaced art is archived.")` |
| 1060 | ⭐ | `…"Queuing…" : "Remake \(selected.count) (⭐\(selected.count))")` |
| 1094 | ✨ | `Text("✨").font(.system(size: 44))` |


### `kid-ios/MyWorld/Views/TileEditSheet.swift` (18 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | → | `…//   • A finished tile the AI mis-named → fix the label/placement; saving PUTs` |
| 11 | → | `…tile the AI couldn't name (vision miss) → type a name; saving creates` |
| 70 | ▶ | `Text("Tap ▶ to hear it. If it sounds off, just spell the name how it should sound.")` |
| 190 | ✅ | `job.statusText = "✅ On the board"` |
| 232 | → | `///   • change the picture (new photo → AI art, or use the photo as-is) and` |
| 397 | ← | `pill("← Move earlier", filled: false, icon: nil)` |
| 401 | → | `pill("Move later →", filled: false, icon: nil)` |
| 435 | ✓ | `moveNote = delta < 0 ? "Moved earlier ✓" : "Moved later ✓"` |
| 475 | ⭐ | `… "Generating…" : "Draw in board style · ⭐1", filled: true)` |
| 486 | ⭐ | `.alert("Use ⭐1?", isPresented: $confirmDraw) {` |
| 490 | ⭐ | `…his photo in the board's art style uses ⭐1. \u{201C}Use photo as-is\u{201D} is free.")` |
| 579 | ▶ | `Text("Tap ▶ to hear it. If it sounds off, spell the name how it should sound.")` |
| 594 | ✓ | `…il ? "Re-record voice" : "Voice updated ✓", filled: false, icon: "mic.fill")` |
| 788 | → | `…/ Renamed without an explicit re-record → re-voice from the new title.` |
| 845 | ✅ | `redrawNote = "✅ Brought back — the swapped-out picture is in Previous pictures."` |
| 868 | ⭐ | `: "Redrawing now (⭐\(r.charged)) — the new picture lands on the board in a minute or two."` |
| 1137 | → | `…h anchors on one scale factor (photo pt → stage pt), so the saved` |
| 1223 | → | `… the framed square. scale maps photo pt → stage pt; the` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/WordShopView.kt` (17 lines)

| Line | Emoji | Context |
|---:|---|---|
| 63 | → | `* folders, cart → credits checkout, folder bundles (20% off), free common-` |
| 110 | ⭐ | `title = { Text("Use ⭐$cost?") },` |
| 111 | ⭐ | `text = { Text("$what uses ⭐$cost. You have ⭐${balance ?: 0}.") },` |
| 162 | ✕ | `Text(if (column.isEmpty()) "✕" else "‹ Shop home",` |
| 170 | ⭐ | `balance?.let { Text("⭐ $it", fontSize = 15.sp, fontWeight = FontWeight.Black, color = Color.White) }` |
| 184 | 🧑🤝 | `SectionRibbon("🧑‍🤝‍🧑", "Shop People") { column = "people" }` |
| 185 | 🧸 | `SectionRibbon("🧸", "Shop Nouns, Adjectives & More") { column = "other" }` |
| 186 | 🏃 | `SectionRibbon("🏃", "Shop Verbs") { column = "verbs" }` |
| 187 | ⭐ | `SectionRibbon("⭐", "Shop Core Words") { column = "needs" }` |
| 206 | ✨ | `Text("✨ Personalize every tile", fontSize = 16.sp,` |
| 231 | ⭐ | `…lse "Personalize ${q.remaining} tiles · ⭐${q.cost ?: q.remaining}",` |
| 258 | 🧩 | `Text("🧩 ADD-ON BOARDS", fontSize = 12.sp,` |
| 349 | ⭐ | `// "⭐N to finish": what completing this category's` |
| 354 | ⭐ | `Text("⭐$finishCost to finish", fontSize = 10.sp, fontWeight = FontWeight.Black,` |
| 383 | ✨⭐ | `Text(if (busy) "…" else "✨ Personalize all ${unpersonalized.size} · ⭐$cost (20% off)",` |
| 408 | ⭐ | `…ord${if (cart.size == 1) "" else "s"} · ⭐${cart.size}",` |
| 477 | ✓ | `Text("✓", fontSize = 13.sp, fontWeight = FontWeight.Black, color = Color.White,` |


### `kid-ios/MyWorld/Parent/WordShopView.swift` (16 lines)

| Line | Emoji | Context |
|---:|---|---|
| 34 | ⭐ | `… into a cart, and check out in CREDITS (⭐1 per word). Each bought word is` |
| 89 | 🧑🤝 | `sectionCard("🧑‍🤝‍🧑", "Shop People", "people")` |
| 90 | 🧸 | `sectionCard("🧸", "Shop Nouns, Adjectives & More", "other")` |
| 91 | 🏃 | `sectionCard("🏃", "Shop Verbs", "verbs")` |
| 92 | ⭐ | `sectionCard("⭐", "Shop Core Words", "needs")` |
| 147 | ⭐ | `Text(balance.map { "⭐ \($0)" } ?? "")` |
| 156 | ⭐ | `title: Text("Use ⭐\(p.cost)?"),` |
| 157 | ⭐ | `message: Text("\(p.what) uses ⭐\(p.cost). You have ⭐\(balance ?? 0)."),` |
| 194 | ✨ | `Text("✨ Personalize every tile")` |
| 203 | ⭐ | `…g…" : "Personalize \(remaining) tiles · ⭐\(q.cost ?? remaining)")` |
| 223 | 🧩 | `Text("🧩 ADD-ON BOARDS")` |
| 305 | ⭐ | `…ndle purchase for an open folder — same ⭐1/word as one-by-one.` |
| 314 | ✨⭐ | `Text(busy ? "…" : "✨ Personalize all \(unpersonalized.count) · ⭐\(cost)")` |
| 351 | ⭐ | `// "⭐N to finish": what completing this category's` |
| 356 | ⭐ | `Text("⭐\(finishCost) to finish")` |
| 442 | ⭐ | `…nt) word\(cart.count == 1 ? "" : "s") · ⭐\(cart.count)")` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/onboarding/OnboardingFlow.kt` (14 lines)

| Line | Emoji | Context |
|---:|---|---|
| 86 | → | `… (email/password only on Android): Demo → Account →` |
| 87 | → | `* Child → Child photo → Parent photo (repeatable) → Seed Core → Done.` |
| 122 | 🌍 | `Text("🌍", fontSize = 30.sp)` |
| 177 | ▶ | `Text("▶️", fontSize = 34.sp)` |
| 409 | → | `// Favorite color → the banner color everywhere (§1); text contrast is` |
| 542 | ▶ | `…tal chips of the ElevenLabs voices with ▶ preview. */` |
| 565 | ▶ | `Text("How the board talks — tap ▶ to hear each voice.", fontSize = 12.sp, color = Brand.muted)` |
| 589 | 🔊 | `Text("🔊", fontSize = 20.sp)` |
| 608 | ▶ | `}) { Text("▶", fontSize = 18.sp, color = Brand.pink) }` |
| 693 | ✅ | `Text("✅", fontSize = 40.sp)` |
| 820 | 📷 | `Text("📷", fontSize = 34.sp)` |
| 854 | 🎨 | `Text("🎨 In your ${c.onboarding.styleLabel} style", fontSize = 13.sp,` |
| 880 | 💳 | `Text("💳", fontSize = 16.sp)` |
| 927 | ✅ | `Text("✅", fontSize = 58.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/HeaderBar.kt` (12 lines)

| Line | Emoji | Context |
|---:|---|---|
| 107 | ⏹ | `) { Text("⏹", fontSize = 22.sp, color = Color(0xFFDC2626)) }` |
| 113 | 🌍 | `Text("🌍", fontSize = 18.sp)` |
| 131 | 🔓🔒 | `Text(if (editMode) "🔓" else "🔒", fontSize = 17.sp,` |
| 139 | 🎙 | `Text("🎙", fontSize = 20.sp, color = textColor.copy(alpha = 0.9f))` |
| 142 | ✏ | `// ✏️ Sentence mode: modal, owned here — while on, the board` |
| 150 | ✏ | `) { Text("✏️", fontSize = 15.sp) }` |
| 154 | ⚙ | `HeaderRound("⚙", onShowDisplay)` |
| 158 | 📖 | `HeaderRound("📖", onTeachTap)` |
| 161 | 🙋 | `if (access.toolPlay) HeaderRound("🙋", onPlayTap)` |
| 178 | ▶ | `* and the ▶ that plays the whole sentence in order. Port of the web bar and` |
| 204 | ✕ | `) { Text("✕", fontSize = 24.sp, color = Color.White) }` |
| 211 | ▶ | `) { Text("▶", fontSize = 24.sp, color = Color.White) }` |


### `kid-ios/MyWorld/Views/MatchingView.swift` (12 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `///   - Wrong tap → no negative feedback. We replay the word and escalate a hint` |
| 11 | → | `///   - Right tap → green pop + confetti, then the next round.` |
| 133 | 🎉 | `Text("🎉").font(.system(size: 96))` |
| 193 | ✕ | `/// can long-hold ✕ to leave early. PRD §3: slides_attempted reflects` |
| 285 | → | `/// eats grass" → horse). PRD §5.` |
| 333 | → | `// Correct → green pop, reinforce the word, confetti, advance.` |
| 344 | → | `// Wrong → escalate a hint on the CORRECT tile, replay the word.` |
| 353 | → | `} else {        // 2nd miss → answer already glowing, move on` |
| 468 | → | `///   glow   → yellow highlight on the correct answer (after 2nd miss / reveal)` |
| 469 | → | `///   wiggle → brief shake on the correct answer (after 1st miss)` |
| 470 | → | `///   pop    → green ring on the answer the child correctly picked` |
| 471 | → | `///   dim    → fade the other tiles once the answer is found` |


### `kid-ios/MyWorld/Views/HeaderBar.swift` (12 lines)

| Line | Emoji | Context |
|---:|---|---|
| 6 | 🔒🙋 | `///   ┌─[🔒]─────[title centered]──────[🙋 Play with me]─┐` |
| 9 | ⚙ | `…k to flip into edit mode (which reveals ⚙ Display +` |
| 54 | → | `// while mainRow's frame animated 104→48 off two of those values —` |
| 114 | ✏ | `// ✏️ Sentence mode: modal, owned here — while on, the board` |
| 133 | → | `…g-press 0.7s = opens the password sheet → unlock on correct password.` |
| 213 | ⏳ | `pillButton("⏳ \(rendering) rendering") { showAddTile = true }` |
| 215 | ⚙ | `pillButton("⚙ Settings")  { showDisplay = true }` |
| 220 | 🧑 | `pillButton("🧑 Parent app") {` |
| 225 | 🩺 | `pillLink(label: "🩺 Therapist",` |
| 234 | ✏ | `Text("✏️")` |
| 246 | 📖 | `Text("📖 Teach me")` |
| 261 | 🙋 | `Text("🙋 Play with me")` |


### `kid-ios/MyWorld/Parent/ParentHomeView.swift` (12 lines)

| Line | Emoji | Context |
|---:|---|---|
| 49 | ⭐ | `badge: creditBalance.map { "⭐ \($0)" }) { StoreView() }` |
| 173 | 🛠✅ | `/// 🛠/✅ Support notice: the team opened the board (with the family's` |
| 207 | ⚠ | `/// ⚠️ Pictures that failed every render attempt — the parent's alert with` |
| 230 | ⭐ | `: (p.freeRetryUsed == true ? "Try again ⭐1" : "Try again (free)"))` |
| 257 | → | `… == p.id } }   // retry re-arms the job → alert clears` |
| 469 | 🛟 | `Button("🛟 Request support…") { supportKind = "support"; supportText = ""; showSupport = true }` |
| 470 | 🐛 | `Button("🐛 Report a bug…") { supportKind = "bug"; supportText = ""; showSupport = true }` |
| 1072 | ⭐ | `// is the ⭐5 keystone render; as-is stays free.` |
| 1082 | ⭐ | `.alert("Use ⭐5?", isPresented: $confirmPortrait) {` |
| 1086 | ⭐ | `…ortrait drawn in the board's style uses ⭐5 (our best likeness model). \u{201C}Use my photo as-is\u{2…` |
| 1141 | ⭐ | `…s a portrait in the board's art style — ⭐5.")` |
| 1181 | → | `// 2) New photo → durable pipeline renders the portrait, registers the` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/SectionColumn.kt` (11 lines)

| Line | Emoji | Context |
|---:|---|---|
| 77 | → | `* title → category chips → subcategory chips → tile grid. Location` |
| 157 | ▶ | `…e pencil): a tap IS the stage — silent; ▶ speaks.` |
| 175 | ▶ | `…/ the child is composing, not speaking; ▶ says the sentence.` |
| 334 | → | `// Dropped on a folder chip → move the tile into that folder.` |
| 468 | → | `// finger, no sibling rect matches → stable.` |
| 546 | ⬆ | `PagerPaddle("⬆", enabled = p > 0, modifier = Modifier.weight(1f)) { onSetPage(maxOf(0, p - 1)) }` |
| 548 | ⬇ | `PagerPaddle("⬇", enabled = p < pageCount - 1, modifier = Modifier.weight(1f)) { onSetPage(minOf(page…` |
| 593 | ✕ | `…eringTileCell. Failed jobs show a small ✕ badge (tap dismisses).` |
| 616 | ✕ | `Text("✕", fontSize = 26.sp, color = Color(0xFFDC2626), fontWeight = FontWeight.Bold)` |
| 622 | → | `…pp restarted / added on another device) →` |
| 624 | 🌍 | `if (job.thumbnail == null) Text("🌍", fontSize = 26.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/PeopleManagerView.kt` (10 lines)

| Line | Emoji | Context |
|---:|---|---|
| 115 | ✕ | `Text("✕", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White,` |
| 138 | 🧒 | `) { Text("🧒 Add your child", fontWeight = FontWeight.Bold) }` |
| 160 | 🙂 | `…ntAlignment = Alignment.Center) { Text("🙂", fontSize = 24.sp) }` |
| 242 | → | `// 2) New photo → durable pipeline (portrait + tile + reference).` |
| 285 | 🙂 | `…ntAlignment = Alignment.Center) { Text("🙂", fontSize = 48.sp) }` |
| 290 | 📷 | `Text(if (jpeg == null) "📷 Choose a photo" else "Choose a different photo",` |
| 305 | ⭐ | `…s a portrait in the board's art style — ⭐5.",` |
| 345 | ⭐ | `…-spend: a styled family portrait is the ⭐5` |
| 355 | ⭐ | `title = { Text("Use ⭐5?") },` |
| 356 | ⭐ | `…ortrait drawn in the board's style uses ⭐5 (our best likeness model). “Use my photo as-is” is free."…` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/AddTileView.kt` (10 lines)

| Line | Emoji | Context |
|---:|---|---|
| 60 | → | `* magic path: pick/take a photo → name + hint + "use my photo as-is"` |
| 61 | → | `…ocks to as-is with the membership note) → durable server job.` |
| 98 | ⭐ | `// the ⭐5 keystone portrait, everything else ⭐1). Server-enforced too.` |
| 148 | ⭐ | `…abel }}) so they show YOUR ${fu.label}? ⭐1 each — replaced art is archived in the Album.") },` |
| 155 | ⭐ | `}) { Text("Remake $n (⭐$n)") }` |
| 210 | 📷 | `) { Text(if (jpeg == null) "📷 Choose a photo" else "Choose a different photo", fontWeight = FontWeig…` |
| 240 | ✨ | `"✨ Want this drawn in your child's art style? Styled tiles are part of My World memberships, from $9…` |
| 262 | ⭐ | `else -> "Generate tile · ⭐$styledCost"` |
| 270 | ⭐ | `title = { Text("Use ⭐$styledCost?") },` |
| 271 | ⭐ | `…wing this in the board's art style uses ⭐$styledCost. “Use my photo as-is” is free.") },` |


### `kid-ios/MyWorld/Models/AccessFeatures.swift` (10 lines)

| Line | Emoji | Context |
|---:|---|---|
| 24 | → | `…re-taps inside this window walk facts 1 → 2 → 3, then the word again.` |
| 27 | ✕ | `//   easyClose  — game ✕ closes on a quick tap instead of the hold.` |
| 28 | ✕ | `//   exitHoldMs — the ✕ hold length when easyClose is off (parent slider).` |
| 34 | → | `…ue into a sane slider range (bad/absent → default).` |
| 212 | ✕ | `stopPlayback()   // ✕ mid-sentence must stop the audio too` |
| 219 | ▶ | `/// Abort ▶ playback: cancel the loop and cut the clip in flight. A second` |
| 220 | ▶ | `/// ▶ also lands here first, so loops can never stack.` |
| 236 | ▶ | `… TTS fallback. Sequential, like the web ▶.` |
| 261 | ▶ | `/// the ▶ that plays the whole sentence. Replaces ALL other header content` |
| 372 | ▶ | `…/ switch users. Shared by the strips (◀ ▶) and grids (▲ ▼).` |


### `kid-ios/MyWorld/Views/DisplaySettingsView.swift` (10 lines)

| Line | Emoji | Context |
|---:|---|---|
| 3 | ⚙ | `/// "⚙ Display" modal — mirrors the web app's Display Settings panel, in the` |
| 5 | → | `/// Board look → Board tools → Touch & play → Listening → Safety & unlock.` |
| 32 | ✕ | `…te private var exitHoldSec = 1.2     // ✕ hold length when easyClose off` |
| 105 | 🎙 | `Toggle("🎙 Listening (live word strip)", isOn: $toolListen)` |
| 107 | 📖 | `Toggle("📖 Teach (word slideshows)", isOn: $toolTeach)` |
| 109 | 🙋 | `Toggle("🙋 Play (find-the-word game)", isOn: $toolPlay)` |
| 111 | ✏ | `Toggle("✏️ Sentence mode", isOn: $toolSentence)` |
| 157 | ✕ | `Text("✕ hold length: \(String(format: "%.1f", exitHoldSec))s")` |
| 191 | ⚙ | `…/ child board (reached from edit mode's ⚙ Settings pill), so` |
| 324 | → | `// Round-trip through UIColor → RGB → hex. Good enough fidelity for` |


### `kid-ios/MyWorld/Views/BoardView.swift` (10 lines)

| Line | Emoji | Context |
|---:|---|---|
| 6 | ← | `…ople │ Nouns │ Verbs                │   ← visible columns set in prefs` |
| 7 | ← | `…── NEEDS strip (optional) ──────────┘   ← horizontal strip, full width` |
| 39 | → | `…tile tapped while the board is unlocked → opens the full board editor.` |
| 64 | ✋ | `Text("✋ Hold a tile until it lifts, then drag it onto another tile to reorder — or onto a folder chi…` |
| 91 | 🔄 | `Text("🔄")` |
| 176 | → | `// Tap a tile while unlocked → the full board tile editor (rename, swap` |
| 281 | → | `/// Brand-new board with no tiles yet → a friendly full-screen welcome that` |
| 321 | ✕ | `…w/game takes the screen. A grown-up can ✕ to skip this round.` |
| 348 | ✕ | `/// native review sheet; ✕ defers it (the tiles are already on the board and` |
| 354 | ✨ | `Text("✨")` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/AlbumView.kt` (8 lines)

| Line | Emoji | Context |
|---:|---|---|
| 60 | → | `* Album → folder (People / Words / Verbs / Celebrations) → tile → every` |
| 65 | 🧑🤝 | `PEOPLE("People", "🧑‍🤝‍🧑"),` |
| 66 | 🏷 | `WORDS("Words", "🏷"),` |
| 67 | 🏃 | `VERBS("Verbs", "🏃"),` |
| 68 | ✨ | `CELEBRATIONS("Celebrations", "✨");` |
| 81 | → | `/** Small blob-key → bitmap image, shared by the parent screens. */` |
| 121 | ✕ | `else -> "✕"` |
| 229 | 🔍 | `leadingIcon = { Text("🔍", fontSize = 16.sp) },` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/DisplaySettingsView.kt` (8 lines)

| Line | Emoji | Context |
|---:|---|---|
| 54 | ⚙ | `* "⚙ Display" — port of `Views/DisplaySettingsView.swift`, in the canonical` |
| 55 | → | `… shares (most common first): Board look →` |
| 56 | → | `* Board tools → Touch & play → Listening → Safety & unlock.` |
| 192 | 🎙 | `ToggleRow("🎙 Listening (live word strip)", toolListen) { on ->` |
| 195 | 📖 | `ToggleRow("📖 Teach (word slideshows)", toolTeach) { on ->` |
| 198 | 🙋 | `ToggleRow("🙋 Play (find-the-word game)", toolPlay) { on ->` |
| 201 | ✏ | `ToggleRow("✏️ Sentence mode", toolSentence) { on ->` |
| 239 | ✕ | `Text("✕ hold length: ${"%.1f".format(exitHoldSec)}s — longer is harder for a child to quit by accide…` |


### `kid-ios/MyWorld/Views/SectionColumn.swift` (8 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `…— no navigation drill-in. Layout: title → category tab` |
| 6 | → | `/// strip → subcategory strip → tile grid.` |
| 11 | → | `/// parent build Places → Home → Kitchen → toaster without nesting four chip` |
| 67 | ▶ | `…e pencil): a tap IS the stage — silent; ▶ speaks.` |
| 138 | → | `// Tap a subcategory chip → speak it (only for location chips, matching` |
| 214 | ✏ | `…t-set `sentenceDrag`; coexists with the ✏️ pencil).` |
| 360 | → | `/// Payload → tile id, enforcing the same-section rule ("no crossing the` |
| 566 | ➕ | `/// The dashed "➕ Add tile" cell at the end of a section's grid (and the Needs` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/StatsView.kt` (7 lines)

| Line | Emoji | Context |
|---:|---|---|
| 61 | ✕ | `if (page == null) "✕" else "‹ Back",` |
| 96 | 📈 | `Triple("usage", "📈", "Usage over time" to "Taps per category, day by day"),` |
| 97 | 🏆 | `Triple("topwords", "🏆", "Top words" to "Most-tapped words this month"),` |
| 98 | 🔎 | `Triple("history", "🔎", "Word history" to "Search every tap, by word and time"),` |
| 99 | 🎯 | `Triple("accuracy", "🎯", "Game accuracy" to "Pass rate by category and by game mode"),` |
| 100 | 🖐 | `Triple("inputs", "🖐", "How they answer" to "Tap · verbal · object · physical · gesture"),` |
| 101 | 🏅 | `Triple("mastery", "🏅", "Mastery & sessions" to "30-day mastery and recent activity"),` |


### `kid-ios/MyWorld/Views/ExpressiveNamingView.swift` (7 lines)

| Line | Emoji | Context |
|---:|---|---|
| 12 | ✕ | `///   - Long-hold ✕ to exit (the universal parent-only gesture).` |
| 15 | → | `///   - Facilitator `mark { method }` → pass with that method, advance.` |
| 16 | → | `///   - Facilitator `skip` / `next` → fail, advance.` |
| 17 | → | `///   - Facilitator `end` → finish (with end_reason='facilitator_stop').` |
| 18 | → | `///   - Time limit → finish (end_reason='timeout').` |
| 70 | ✕ | `// self-drive. Long-hold of the ✕ in the corner is the exit; this is` |
| 104 | 🎉 | `Text("🎉").font(.system(size: 96))` |


### `kid-ios/MyWorld/Parent/StoreView.swift` (7 lines)

| Line | Emoji | Context |
|---:|---|---|
| 98 | ⭐ | `…then packs stack on top of your monthly ⭐.")` |
| 164 | ⭐→ | `…lways finishes enrollment with at least ⭐50 remaining. Cancel anytime: everything you've made stays …` |
| 188 | ⭐ | `Text(balance.map { "⭐ \($0)" } ?? "⭐ …")` |
| 207 | ⭐ | `… starter board personalized up front (a ⭐120+ value) · ⭐50/month · speech-to-text · auto-teach · rep…` |
| 208 | ⭐ | `…    return "same enrollment build — and ⭐50 still yours after sign-up · ⭐150/month · biggest voice b…` |
| 337 | ⭐ | `… credited, credited > 0 { note = "Added ⭐\(credited) — thank you!" }` |
| 355 | ⭐ | `note = "Added ⭐\(r.credited) — enjoy!"` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/FacilitatorView.kt` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 68 | ⭐ | `…i ?: 0) + 1} of ${payload.total ?: 0} · ⭐ ${payload.correctCount ?: 0}"` |
| 94 | 🗣 | `MarkButton("🗣 Said it", Brand.verbalInk) { send("action" to "mark", "method" to "verbal") }` |
| 95 | ✋ | `MarkButton("✋ Gesture", Brand.objectInk) { send("action" to "mark", "method" to "gesture") }` |
| 99 | 🧸 | `MarkButton("🧸 Object", Brand.objectInk) { send("action" to "mark", "method" to "object") }` |
| 100 | 🤝 | `MarkButton("🤝 Helped", Brand.tapInk) { send("action" to "mark", "method" to "physical") }` |
| 109 | → | `) { Text("Skip →", fontWeight = FontWeight.Bold, color = Brand.pinkDeep) }` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/BoardView.kt` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 226 | → | `…ight(1f, fill = true))   // freed space → whitespace` |
| 236 | → | `// Brand-new board with no tiles yet → friendly welcome (after the` |
| 248 | ✋ | `"✋ Hold a tile until it lifts, then drag it onto another tile to reorder — or onto a folder chip to …` |
| 324 | → | `…each staged an activity: countdown card → session with the` |
| 325 | ✕ | `// slugs: scope; ✕ skips this round. Never over a running game/edit.` |
| 361 | ✕ | `…smissRequest = { /* games exit via hold-✕ or completion only */ },` |


### `kid-ios/MyWorld/Views/SlideshowView.swift` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 6 | ✕ | `…deck until the time limit (or long-hold ✕). Passive` |
| 11 | ✕ | `… anywhere advances early; long-hold the ✕ in the corner to exit.` |
| 61 | ✕ | `// Long-hold ✕ to exit (consistent across every full-screen view).` |
| 68 | ✕ | `// shouldn't skip slides. Long-hold ✕ is the only exit.` |
| 156 | 📖 | `…ild-launched teaching slideshow (header 📖 button).` |
| 161 | ✕ | `…y itself after the last tile; long-hold ✕ to leave early.` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/UpdateGateView.kt` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 45 | → | `*   below minBuild  → full-screen update wall (known-broken build);` |
| 46 | → | `*   below softBuild → dismissible "update available" card, once per launch.` |
| 47 | → | `…lds default to 0 server-side (env unset → gate off) and every` |
| 94 | ⬇ | `Text("⬇️", fontSize = 44.sp)` |
| 136 | ✨ | `Text("✨", fontSize = 18.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/AutoTeachView.kt` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 133 | ✕ | `Text("✕", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White,` |
| 151 | → | `// HARD GATE: no quiet hours → no auto-teach.` |
| 399 | ✅⏸ | `Text(if (ok) "✅" else "⏸", fontSize = 13.sp)` |
| 411 | 🩺🏫 | `Text(if (w.type == "therapy") "🩺 Therapy" else "🏫 School",` |
| 417 | 🗑 | `TextButton(onClick = onDelete) { Text("🗑", fontSize = 14.sp) }` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/BoardTileEditSheet.kt` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 182 | ← | `…tButton(onClick = { move(-1) }) { Text("← Move earlier", color = Brand.pinkDeep) }` |
| 183 | → | `…Click = { move(1) }) { Text("Move later →", color = Brand.pinkDeep) }` |
| 204 | ✨ | `Text("✨ Match my child's style", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)` |
| 211 | 🎨 | `Text("🎨 Redraw with my note (1st free)", color = Brand.pinkDeep, fontWeight = FontWeight.Bold)` |
| 247 | ✅ | `note = "✅ Brought back — the swapped-out picture is in Previous pictures."` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/game/MatchingView.kt` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 76 | → | `*  - wrong tap → no negative feedback; 1st miss wiggles + glows the answer` |
| 79 | → | `*  - correct tap → green pop + confetti + FULL PASS regardless of misses` |
| 236 | → | `// Correct → FULL PASS regardless of misses (mercy v2).` |
| 318 | 🎉 | `Text("🎉", fontSize = 96.sp)` |
| 335 | 🔊 | `Text("🔊", fontSize = 24.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/access/AccessFeatures.kt` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 45 | ✕ | `//   easyClose  — game ✕ closes on a quick tap instead of the long-press.` |
| 46 | ✕ | `//   exitHoldMs — the ✕ hold length when easyClose is off (parent slider).` |
| 222 | ✕ | `stopPlayback()   // ✕ mid-sentence must stop the audio too` |
| 229 | ▶ | `/** Abort ▶ playback: cancelling the Job propagates into playFileAwait's` |
| 231 | ▶ | `…ses the in-flight MediaPlayer. A second ▶ lands here first, so` |


### `kid-ios/MyWorld/Storage/AddTileQueue.swift` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 323 | ✅ | `job.statusText = s.needsReview ? "✅ On the board — needs review"` |
| 324 | ✅ | `: (s.artFailed ? "✅ Saved your photo — art didn't render" : "✅ On the board")` |
| 335 | 🎨 | `job.statusText = "🎨 Making the tile…"` |
| 358 | → | `…guess .nouns/nil, which matched nothing → invisible).` |
| 421 | → | `…ge generation. Open platform.openai.com → Settings → Organization → Verify, then retry."` |


### `kid-ios/MyWorld/Storage/BoardStore.swift` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 17 | → | `…flags from the last sync (nil = unknown → permissive;` |
| 94 | → | `///   - "all"            → every tile` |
| 95 | → | `///   - "people"/"nouns"/"verbs" → that whole section` |
| 96 | → | `///   - "cat:<id>"       → that category + all its descendant categories` |
| 172 | → | `// Order: People → Nouns → Verbs → Needs, each by display order. Folder` |


### `kid-ios/MyWorld/Network/APIClient.swift` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 42 | → | `…s. nil = unknown (old server / offline) → be permissive; the server` |
| 184 | ▶ | `/// Log one ▶ of the sentence builder (mode='sentence'; the text rides in` |
| 566 | → | `/// POST /api/tts { text, emotion } → audio/mpeg bytes (ElevenLabs voice).` |
| 693 | → | `…ership (server-resolved: admin override →` |
| 694 | → | `/// live subscription → free), plus this month's voice budget.` |


### `kid-ios/MyWorld/Views/ScheduledPromptViews.swift` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 195 | → | `…MARK: -- Game nudge ("Let's do a game!" → Play / Not now)` |
| 235 | ▶ | `Text("▶ Play")` |
| 277 | ✕ | `…en fires; a grown-up (or the child) can ✕ to skip` |
| 290 | 🎮📚 | `mode == "game" ? "Game time! 🎮" : "Learning time! 📚"` |
| 295 | 🎮📚 | `Text(mode == "game" ? "🎮" : "📚").font(.system(size: 34))` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/model/DeviceCapabilities.kt` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 27 | ✅ | `"✅ Speech-to-text listening works here"` |
| 29 | ⚠ | `"⚠️ No speech-recognition service on this device (normal on Fire tablets) — listening mode is unavai…` |
| 31 | ✅ | `"✅ Purchases through Google Play"` |
| 33 | ℹ | `"ℹ️ No Google Play on this device — purchases use the secure web store instead"` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/MessageBoardView.kt` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 76 | ✅ | `if (tabletOnline) "Tablet connected ✅" else "The board will show it when it's next open",` |
| 120 | ✅ | `if (tabletOnline) "Tablet connected ✅" else "The tablet must be open for listening to start",` |
| 135 | 🎙 | `) { Text("🎙 Start listening on the tablet", fontWeight = FontWeight.Bold) }` |
| 140 | ⏹ | `) { Text("⏹ Stop listening", color = Brand.pinkDeep) }` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/StartGameView.kt` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 45 | → | `…+ scope + choices + sample + time limit → publishes the same` |
| 101 | ✅ | `if (tabletOnline) "Tablet connected ✅" else "Waiting for the tablet… (open the board)",` |
| 128 | ✅ | `) { Text(if (sent) "Sent to the board ✅" else "Start on the board", fontSize = 16.sp, fontWeight = F…` |
| 147 | ✓ | `if (selected) Text("✓", color = Brand.pink, fontWeight = FontWeight.Bold)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/game/AutoTeachCountdownCard.kt` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 33 | 📚 | `* "Learning time! 📚" — the friendly 10-second staging card auto-teach shows` |
| 34 | ✕ | `…w/game takes the screen. A grown-up can ✕ to skip this` |
| 62 | ✕ | `) { Text("✕", fontSize = 17.sp, color = Brand.pinkDeep) }` |
| 64 | 📚 | `Text("📚", fontSize = 52.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/audio/TilePlayer.kt` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 22 | → | `…ree-level fallback: cached soundKey mp3 → local TextToSpeech → no-op.` |
| 44 | → | `// 0→1→2 across rapid re-taps; the window is TouchConfig.teachTapMs.` |
| 93 | → | `// every fact heard → fall through: the word, chain restarts` |
| 119 | ▶ | `*  stages silently (▶ does the talking) but milestones still see combos. */` |


### `kid-ios/MyWorld/Views/CameraPicker.swift` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 35 | → | `// No camera hardware (Simulator) → CameraPicker's own photo-library` |
| 64 | 📷 | `Text("📷").font(.system(size: 44))` |
| 71 | → | `Text("Settings → Screen Time → Content & Privacy Restrictions → Allowed Apps & Features → turn on Ca…` |
| 76 | → | `…creen Time may be blocking it: Settings → Screen Time → Content & Privacy Restrictions → Allowed App…` |


### `kid-ios/MyWorld/Parent/OnboardingCoordinator.swift` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | → | `case childPhoto      // capture child → stylize → review → commit` |
| 10 | → | `…ase parentPhoto     // capture grown-up → stylize → review → commit` |
| 60 | → | `/// shares one look. nil → the server falls back to the first active guide.` |
| 65 | → | `… every generated tile speaks in it. nil → env default.` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/MainActivity.kt` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 25 | → | `* `ContentView.swift`: signed out → Login; role unset → RolePicker;` |
| 26 | → | `* childBoard → BoardView; parent → ParentHomeView.` |
| 53 | → | `// Brand-new families see the demo → account → setup flow; the account` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/LongPressExitButton.kt` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 22 | ✕ | `* The universal hold-to-exit ✕ every full-screen child view uses — port of` |
| 56 | → | `…k completes (true) on release OR cancel →` |
| 70 | ✕ | `Text("✕", fontSize = 22.sp, color = tint)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/RolePickerView.kt` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 51 | 🌍 | `Text("🌍", fontSize = 64.sp)` |
| 61 | 👆 | `emoji = "👆",` |
| 70 | 🧑 | `emoji = "🧑",` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/StoreView.kt` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 170 | ⭐ | `Text("⭐ ${p.credits} — ${p.label.ifEmpty { p.sku }}",` |
| 196 | 🛍 | `Text("🛍 Shop words for the board", fontWeight = FontWeight.Bold)` |
| 223 | ⭐ | `"⭐ ${r.credited} credits added!"` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/SchedulesView.kt` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 93 | ✕ | `Text("✕", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Color.White,` |
| 162 | ❓🎮🔔 | `…al emoji = when (type) { "question" -> "❓"; "game" -> "🎮"; else -> "🔔" }` |
| 187 | 🗑 | `TextButton(onClick = onDelete) { Text("🗑", fontSize = 15.sp) }` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/CategoryStrips.kt` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 194 | ▶ | `…en cut off leads the next page), with ◀ ▶ paddles` |
| 221 | ▶ | `StripPaddle("▶", enabled = p < pageCount - 1, visible = pageCount > 1) { page = minOf(pageCount - 1,…` |
| 321 | 📁 | `Text("📁", fontSize = 20.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/NeedsStrip.kt` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 74 | ▶ | `…e pencil): a tap IS the stage — silent; ▶ speaks.` |
| 116 | ▶ | `// Logged, not spoken — ▶ says the sentence.` |
| 153 | ▶ | `PagerPaddle("▶", enabled = p < pageCount - 1, modifier = Modifier.width(44.dp)) { page = minOf(pageC…` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/billing/BillingClientManager.kt` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 51 | → | `/** sku → details (price strings for the buttons). */` |
| 55 | ⭐ | `…line user-facing status ("Verifying…", "⭐ 50 credits added!"). */` |
| 185 | ⭐ | `r.credited > 0 -> "⭐ ${r.credited} credits added!"` |


### `kid-ios/MyWorld/UpdateGate.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `///   - below `minBuild`  → a full-screen update wall (the build is known-broken` |
| 10 | → | `///   - below `softBuild` → a dismissible "update available" card, once per` |
| 12 | → | `…lds default to 0 server-side (env unset → gate off), and ANY` |


### `kid-ios/MyWorld/Models/Category.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 20 | → | `///   "location" → tap-to-speak + show its children as room tiles` |
| 21 | → | `///   "room"     → short-press speaks, long-press opens its interior` |
| 22 | → | `///   nil        → normal category (default)` |


### `kid-ios/MyWorld/Views/EmptyBoardView.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | → | `…play name for the copy ("" when unknown → generic wording).` |
| 28 | 🎨 | `Text("🎨").font(.system(size: 60))` |
| 53 | ✨ | `Text("✨ Generate starter words")` |


### `kid-ios/MyWorld/Views/UnlockSheet.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 3 | → | `…entering edit mode. Long-press the lock → this sheet` |
| 4 | → | `…// appears. Parent types their password → we POST /api/auth/login with the` |
| 72 | → | `// Big, obvious exit. Kid taps Cancel → back to the board.` |


### `kid-ios/MyWorld/Views/RoomTile.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `///   short tap   → speak the room's name (no nav, no surprises)` |
| 8 | → | `///   long press  → open the room's interior (its items in an overlay)` |
| 75 | → | `/// Unlocked board → tiles inside the room are tap-to-edit too.` |


### `kid-ios/MyWorld/Parent/FacilitatorView.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 79 | 🎯 | `.overlay(Text("🎯").font(.system(size: 34)))` |
| 85 | 🎉 | `…e.status?.status == "ended" ? "finished 🎉" : "tap a mark when ready")` |
| 140 | → | `…trolButton(action: "next", label: "Next →", bg: Brand.nextBg, ink: Brand.nextInk)` |


### `kid-ios/MyWorld/Audio/SpeechListener.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 25 | → | `… Rolling window of recent words (oldest → newest) for the strip.` |
| 98 | → | `// route (a stale engine → 0-sample-rate "format unavailable").` |
| 159 | → | `…nce its neighbor lands ("papa" + "gary" →` |


### `kid-ios/MyWorld/Audio/GameAudio.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 95 | → | `/// "Teach me" slideshow chains word → clue → clue → clue this way. Same` |
| 111 | ▶ | `…// Cut the speech channel NOW (sentence ▶ stopped, mode exited, a game or` |
| 119 | ▶ | `/// the sentence bar's ▶ chains staged tiles' recorded clips this way.` |


### `kid-ios/MyWorld/Audio/TilePlayer.swift` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 20 | → | `// index walks 0→1→2 across rapid re-taps; the window comes from the` |
| 66 | → | `// every fact heard → fall through: the word, chain restarts` |
| 95 | ▶ | `/// stages silently (▶ does the talking) but milestones still see combos.` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/net/ApiItems.kt` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 88 | → | `/** POST /api/upload — raw bytes → private blob key. */` |
| 97 | → | `* POST /api/tile-jobs — enqueue a photo→tile job (durable server-side: the` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/TileView.kt` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 118 | ✎ | `Text("✎", fontSize = 16.sp, color = Brand.pink,` |
| 123 | ★ | `Text("★", fontSize = 13.sp, color = Color(0xFFF5C518),` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/MessageOverlayView.kt` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 54 | → | `* sound → TTS); the whole sentence shows as a caption. Tap anywhere skips.` |
| 92 | 💬 | `Text("💬 A message for you!", fontSize = 26.sp, fontWeight = FontWeight.Bold,` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/game/SlideshowView.kt` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 50 | ✕ | `* or hold-✕. Learn mode plays recorded audio; exposure TTS "I can see a ___".` |
| 94 | ✕ | `…loops forever — the limit timer or hold-✕ ends it` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/theme/Brand.kt` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 47 | → | `/** "#ff1493" / "ff1493" → Color, mirroring the iOS `Color(hex:)` extension. */` |
| 56 | → | `* "people.community.workers" → "People › Community › Workers" — parents get` |


### `kid-ios/MyWorld/ContentView.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | → | `…all starts in the onboarding flow (demo → account → child` |
| 10 | → | `/// → photos → seed). The flow short-circuits to the appropriate post-onboard` |


### `kid-ios/MyWorld/Live/LiveSession.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 69 | → | `…api/live (~1s) for facilitator commands → exposes `latest`.` |
| 140 | 🎉 | `…/ Game finished — phone shows "finished 🎉".` |


### `kid-ios/MyWorld/Live/Scheduler.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `///       timing=times    → fire once per HH:MM that matches today (deduped)` |
| 9 | → | `///       timing=interval → fire every intervalMin (deduped via timestamp)` |


### `kid-ios/MyWorld/Storage/MediaCache.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 68 | → | `/// decode (corrupt cache entry → caller can re-fetch by deleting + retrying).` |
| 121 | → | `…ove every cached blob. Used by Settings → "Clear cache".` |


### `kid-ios/MyWorld/Models/Brand.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 35 | → | `/// "people.community.workers" → "People › Community › Workers" — skill slugs` |
| 37 | → | `/// segments get real names (expr → Expressive).` |


### `kid-ios/MyWorld/Views/CategoryStrips.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 14 | ▶ | `…-navigation mode: page the chips with ◀ ▶ instead of scrolling.` |
| 100 | ▶ | `/// inline ◀ ▶ paddles sized for imprecise pointing.` |


### `kid-ios/MyWorld/Parent/AutoTeachView.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 76 | → | `// HARD GATE: no quiet hours → no auto-teach. The alert` |
| 186 | 🩺🏫 | `…ext(w.wrappedValue.type == "therapy" ? "🩺 Therapy" : "🏫 School")` |


### `kid-ios/MyWorld/Parent/ParentAPI.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 92 | → | `…ecoder: every section optional, missing → empty default.` |
| 291 | → | `…embership feature (nil on older servers → treat as subscribed).` |


### `kid-ios/MyWorld/Parent/AlbumView.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 6 | → | `///   Album → Section folder → Tile → all versions of that tile, newest first` |
| 109 | → | `/// Album → folder. Sections collapse into four parent-friendly buckets so the` |


### `kid-ios/MyWorld/Parent/StatsView.swift` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 130 | ▶ | `…on and your child plays a sentence with ▶, it lands here — what they said, and when.")` |
| 159 | ↑↓ | `Text(diff > 0 ? "↑ \(diff) vs last week" : "↓ \(-diff) vs last week")` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/MyWorldApp.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 80 | → | `…ay billing (verify-before-consume; Fire → web store).` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/model/Board.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 88 | → | `/** "location" → children render as room tiles; "room" → long-press opens interior. */` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/model/DisplayPrefs.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 154 | → | `/** "fletcherpeterson" → "Fletcher"; numbered-dupe suffixes dropped. */` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/net/PersistentCookieJar.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 23 | → | `/** host → (name → serialized cookie) */` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/net/ApiOnboarding.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 92 | → | `/** Stylize a raw JPEG → DRAFT blob key (doesn't commit; retries are free). */` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/LoginView.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 65 | 🌍 | `Text("🌍", fontSize = 72.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/parent/WordStatsViews.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 196 | → | `/** Today → "3:42 PM", earlier → "Jun 12 · 3:42 PM" (iOS parity). */` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/EmptyBoardView.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 49 | 🌍 | `Text("🌍", fontSize = 64.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/RoomTile.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 81 | 🚪 | `} else Text("🚪", fontSize = 28.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/board/ListenStripView.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 94 | 🎙 | `item { Text("🎙", fontSize = 20.sp, color = Color(0xFFDC2626)); Spacer(Modifier.width(8.dp)) }` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/game/ExpressiveNamingView.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 169 | 🎉 | `Text("🎉", fontSize = 96.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/ui/game/CelebrationView.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 38 | 🎉 | `Text("🎉", fontSize = 110.sp)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/game/ListenTokenizer.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 20 | → | `* words token-by-token ("12" → "twelve") so recognizer output meets labels.` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/audio/SpeechListener.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 30 | → | `* there's no recognition service → `available` is false and the board shows` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/storage/AddTileQueue.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 140 | → | `// A finished multi-photo batch → the review banner (once).` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/live/ParentLive.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 18 | → | `* polls /api/live every 1.5s → `tabletOnline` (status != idle && age < 8s)` |


### `android-native/app/src/main/java/io/andrewpeterson/myworld/live/LiveSession.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 18 | → | `…api/live (~1s) for facilitator commands → `latest` (seq-deduped,` |


### `kid-ios/MyWorld/Live/AutoTeachRunner.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | ✕ | `…ctually take the screen (a grown-up can ✕ to skip that` |


### `kid-ios/MyWorld/Models/DisplayPrefs.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 243 | → | `…e a prettified slug ("fletcherpeterson" → "Fletcher"; a numbered-dupe` |


### `kid-ios/MyWorld/Views/CelebrationView.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 19 | 🎉 | `Text("🎉").font(.system(size: 120))` |


### `kid-ios/MyWorld/Views/LongPressExitButton.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | ✕ | `/// The ✕ pattern used across all full-screen child views (matching, slideshow,` |


### `kid-ios/MyWorld/Views/BatchReviewView.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 47 | ▶ | `Text("Tap ▶ to hear each voice. Fix any name the AI got wrong — what you type wins.")` |


### `kid-ios/MyWorld/Views/ListenStripView.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 33 | → | `// Token-level digit → word ("12 o'clock" → "twelve o'clock").` |


### `kid-ios/MyWorld/Views/NeedsStrip.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 57 | → | `// Locked + empty → nothing. Unlocked → always show the strip so the` |


### `kid-ios/MyWorld/Parent/QuickBoardView.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 25 | → | `// Fill that sweeps left→right while holding, so the parent gets` |


### `kid-ios/MyWorld/Parent/WordHistoryView.swift` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 166 | → | `// Today → "3:42 PM", earlier → "Jun 12 · 3:42 PM"` |


## 3 · Admin pages (operator-only) — 333 lines across 12 files


### `admin/voices.html` (63 lines)

| Line | Emoji | Context |
|---:|---|---|
| 71 | 🎙 | `<h1>🎙️ Voice library</h1>` |
| 74 | ↻ | `<button id="refresh">↻ Refresh</button>` |
| 75 | → | `…"/admin/publish.html">Publish to boards →</a>` |
| 76 | ← | `…lass="back" href="/admin/defaults.html">← Default board</a>` |
| 77 | ← | `<a class="back" href="/admin/">← Lab home</a>` |
| 110 | 🌍 | `<h2>🌍 Practice-board voices</h2>` |
| 124 | ⚡ | `…ton class="primary" id="demo-build-all">⚡ Prepare all active English voices</button>` |
| 131 | ▶ | `…dard-library word in each active voice. ▶ plays the exact cached clip every` |
| 132 | ↻ | `board plays; ↻ re-renders it (overwriting the shared cache) and plays the fresh take.` |
| 133 | 🎧 | `<b>🎧 Listen &amp; confirm</b> reviews EVERYTHING the voice says — every word AND every learning-mode` |
| 134 | ▶ | `…ing fact — one window, back to back: <b>▶▶ Hands-free</b> auto-approves each clip as you hear it` |
| 135 | ←↻ | `(← Back withdraws one, ↻ re-renders it); progress saves continuously, so close anytime and resume on` |
| 136 | ✓ | `any machine. In a hurry? <b>✓ Approve whole voice</b> marks everything without listening.` |
| 140 | ▶ | `<button id="preview-btn">▶ Preview voice</button>` |
| 142 | 🎧 | `<button class="primary" id="review-btn">🎧 Listen &amp; confirm (words + facts)</button>` |
| 143 | ✓ | `…t listening — spot-check later anytime">✓ Approve whole voice</button>` |
| 144 | ▶ | `<button id="playall-btn">▶ Play all (top 20 visible)</button>` |
| 145 | ⏹ | `<button id="stop-btn" disabled>⏹ Stop</button>` |
| 151 | ✓ | `…firm: auto-playing clip-by-clip review. ✓ saves a QC mark` |
| 152 | ↻ | `(server-side, resumes anywhere), ↻ re-renders (optionally with a` |
| 161 | ↻ | `…0 14px;">Type how it should SOUND, then ↻ — boards speak the override; the label keeps the real spel…` |
| 163 | ✓ | `…ght:800;font-size:17px;cursor:pointer;">✓ Sounds right</button>` |
| 164 | ↻ | `…ght:800;font-size:17px;cursor:pointer;">↻ Retry</button>` |
| 166 | ▶ | `…ght:700;font-size:14px;cursor:pointer;">▶▶ Hands-free — clips approve as you hear them</button>` |
| 167 | ✓ | `…ry clip you hear all the way through is ✓ approved automatically —` |
| 168 | ⏸←↻ | `press ⏸, ← Back, or ↻ only when something sounds wrong. Progress saves as you go; close anytime and …` |
| 170 | ← | `…und:none;color:#64748b;cursor:pointer;">← Back (un-approve)</button>` |
| 171 | ▶ | `…und:none;color:#64748b;cursor:pointer;">▶ Replay (space)</button>` |
| 172 | → | `…one;color:#64748b;cursor:pointer;">Skip →</button>` |
| 173 | ✓ | `…16a34a;font-weight:700;cursor:pointer;">✓ Save &amp; close (esc)</button>` |
| 176 | ←→ | `…ds right · R = retry · A = hands-free · ← = back · → = skip</div>` |
| 203 | → | `// POST /api/tts → audio blob. The server caches by (model\|voice\|emotion\|text)` |
| 223 | → | `… client-side blob cache: "voiceId\|text" → Blob` |
| 224 | ✓ | `…or the SELECTED voice: server-persisted ✓ marks` |
| 306 | ✕ | `…og (children already using it keep it)">✕</button></td>` |
| 428 | ✓ | `…ookedUp ? ' — looked up from ElevenLabs ✓' : '');` |
| 459 | ✓ | `…pproved.has(x.w.label.toLowerCase()) ? '✓ ' : ''}${esc(x.w.label)}</span>` |
| 460 | ▶ | `…e cached clip (what every board plays)">▶</button>` |
| 461 | ↻ | `…venLabs and overwrite the shared cache">↻</button>` |
| 500 | ▶ | `// ▶ Play all: the first 20 rows currently visible (after the filter), in` |
| 501 | ⏹ | `// order, one after another. ⏹ stops between (or during) clips.` |
| 539 | ✓ | `// ✓ Approve whole voice — publish without reviewing each utterance. One` |
| 542 | ← | `// ← Back / the per-word grid.` |
| 547 | ✓←▶↻ | `…rd-library word and every teaching fact ✓ for this voice. You can still spot-check anytime — Listen …` |
| 553 | ✓ | `msg.textContent = `✓ Approved ${r.approved} clips for ${voice.name}.`;` |
| 565 | ✓ | `// Auto-plays clip after clip; ✓ approves (server-side mark, auto-advances,` |
| 566 | ↻ | `// auto-plays the next), ↻ re-renders — with an optional phonetic override` |
| 572 | ✓↻ | `…ck, pausing only when something needs a ✓ decision or a ↻.` |
| 595 | ↻ | `…are prose — a bad fact clip just gets a ↻ re-render.` |
| 616 | 🎉 | `rv('rv-word').textContent = '🎉 All approved!';` |
| 669 | ✓ | `// all the way through IS the approval (✓ saved automatically) — then` |
| 671 | ← | `// leaves that clip UNapproved; ← Back un-approves the one just heard.` |
| 685 | → | `// Heard in full → auto-approve (server mark; progress survives exit).` |
| 699 | ⏸▶ | `if (b) b.textContent = on ? '⏸ Pause hands-free (current clip stays unapproved)' : '▶▶ Hands-free — …` |
| 702 | ← | `// ← Back: the objection path — return to the previous clip, WITHDRAW its` |
| 703 | ✓↻ | `// ✓ (it was auto-approved as it played), and replay it for a ↻ / re-listen.` |
| 708 | 🎉→ | `…dx = q.length - 1;          // from the 🎉 screen → last clip` |
| 725 | ✓ | `renderWords();   // reflect fresh ✓ marks in the list` |
| 786 | ✓ | `…at getClip does). Facts carry their own ✓ key.` |
| 793 | 📖 | `group: '📖 teaching fact · ' + w.label,` |
| 824 | ✅ | `+ '<td>' + (done ? '✅ ' : '') + n + (DEMO_TOTAL ? ' / ' + DEMO_TOTAL : '') + '</td>'` |
| 826 | ⚡ | `+ (n > 0 && !done ? '⚡ Resume copy + fill' : '⚡ Copy + fill clips') + '</button></td></tr>';` |
| 850 | ✅ | `msg.textContent = '✅ Done — ' + fromCache + ' copied free from your existing voice cache, '` |


### `admin/index.html` (58 lines)

| Line | Emoji | Context |
|---:|---|---|
| 12 | → | `• Content & layout — sections → categories → subcategories → items, wired to` |
| 94 | ✨↗ | `…dmin/style-wizard.html" target="_blank">✨ New Style ↗</a>` |
| 95 | ↗ | `…f="/admin/lab.html" target="_blank">Lab ↗</a>` |
| 96 | ↗ | `…-lab.html" target="_blank">Portrait Lab ↗</a>` |
| 97 | ↗ | `…-lab.html" target="_blank">Add-Tile Lab ↗</a>` |
| 98 | ↗ | `…taxonomy.html" target="_blank">Taxonomy ↗</a>` |
| 99 | ↗ | `…lts.html" target="_blank">Default board ↗</a>` |
| 100 | ↗ | `…yout.html" target="_blank">Board layout ↗</a>` |
| 101 | ↗ | `…ces.html" target="_blank">Voice library ↗</a>` |
| 102 | ↗ | `…n/publish.html" target="_blank">Publish ↗</a>` |
| 103 | ↗ | `…n/reports.html" target="_blank">Reports ↗</a>` |
| 104 | ↗ | `…n/support.html" target="_blank">Support ↗</a>` |
| 105 | ↗ | `…k-app" href="#" target="_blank">Kid app ↗</a>` |
| 106 | ↗ | `…parent" href="#" target="_blank">Parent ↗</a>` |
| 107 | ↗ | `…ist" href="#" target="_blank">Therapist ↗</a>` |
| 124 | ↻ | `<button class="btn ghost" id="reload">↻ Reload</button>` |
| 134 | ↗ | `….html" target="_blank">Open full screen ↗</a></p>` |
| 141 | ↻ | `…ton class="btn ghost" id="usage-reload">↻ Reload</button>` |
| 175 | ⭐ | `…its" type="number" min="0" placeholder="⭐ credits" title="Credits granted on signup" style="padding:…` |
| 185 | ⭐ | `<h3>⭐ Grant credits</h3>` |
| 200 | 🎟 | `<h3>🎟️ Coupon codes</h3>` |
| 218 | 👪 | `<h3>👪 Families — onboarding health</h3>` |
| 219 | →🚩 | `<p>One row per account: signup → payment → credits → what actually landed on the board. Rows flagged…` |
| 231 | ↗ | `…f="/admin/lab.html" target="_blank">Lab ↗</a> — tile generation, style guides, master prompt, batch …` |
| 232 | ↗ | `…-lab.html" target="_blank">Portrait Lab ↗</a> — bench for onboarding people-portrait generation.</li…` |
| 233 | ↗ | `…-lab.html" target="_blank">Add-Tile Lab ↗</a> — bench for the add-a-photo tile pipeline (style on/of…` |
| 234 | ↗ | `…taxonomy.html" target="_blank">Taxonomy ↗</a> — the canonical tile-prompt library (snapshots, bulk o…` |
| 235 | ↗ | `…lts.html" target="_blank">Default board ↗</a> — the per-style default boards: board-shaped review of…` |
| 236 | ↗ | `…yout.html" target="_blank">Board layout ↗</a> — drag categories, subcategories, and words into the o…` |
| 237 | ↗ | `…ces.html" target="_blank">Voice library ↗</a> — add ElevenLabs voices by id (no code), toggle what o…` |
| 238 | ↗ | `…n/publish.html" target="_blank">Publish ↗</a> — push the curated layout order and voice-clip fixes o…` |
| 239 | ↗ | `…n/support.html" target="_blank">Support ↗</a> — the consented-access inbox: family support/bug cases…` |
| 240 | ↗ | `…n/reports.html" target="_blank">Reports ↗</a> — launch ops: board sync heartbeats, last logins, purc…` |
| 354 | ⭐ | `if (c.grant_credits > 0) bits.push('⭐' + c.grant_credits);` |
| 378 | ✕ | `…y" data-inv-act="del" data-id="${c.id}">✕</button>` |
| 430 | ⭐→ | `status.textContent = `⭐${d.credited} → ${email} (balance now ${d.balance})`;` |
| 439 | ⭐ | `if (!confirm(`Grant ⭐${credits} to EVERY non-admin account? This can't be undone.`)) return;` |
| 443 | ⭐ | `status.textContent = `⭐${d.credited} granted to ${d.users} accounts.`;` |
| 458 | ⭐ | `<td>⭐${c.credits}</td>` |
| 541 | 🔑 | `…tyle="font-size:12px;padding:4px 10px;">🔑 Reset password</button>`` |
| 544 | ⭐ | `…on't deposit monthly image credits; use ⭐ Grant credits on the Invites tab for that. "Real" means wh…` |
| 558 | → | `out.textContent = `Setting ${email} → ${tier}…`;` |
| 569 | → | `// Child link → load that child everywhere in the admin.` |
| 619 | ☠ | `…{s[k].done}/${s[k].total}${s[k].dead ? `☠${s[k].dead}` : ''}` : '')` |
| 622 | ⭐ | `…</th><th>Signed up</th><th>Paid</th><th>⭐</th><th>Tier</th><th>Step</th><th>Images</th><th>Seed jobs…` |
| 624 | 🚩 | `<td>${r.flagged ? '🚩' : ''}</td>` |
| 635 | 🧰 | `…style="font-size:12px;padding:4px 8px;">🧰 Rebuild</button>` |
| 636 | 🖼 | `…style="font-size:12px;padding:4px 8px;">🖼️ Defaults</button>`` |
| 660 | → | `status.textContent = `Defaults → ${el.dataset.slug}: ${r.nextOffset}/${total}…`;` |
| 694 | ↑ | `…{type}" data-id="${id}" title="Move up">↑</button>` |
| 695 | ↓ | `…ype}" data-id="${id}" title="Move down">↓</button>` |
| 696 | ✎ | `…${type}" data-id="${id}" title="Rename">✎</button>` |
| 697 | ✕ | `…${type}" data-id="${id}" title="Delete">✕</button>` |
| 727 | ↳ | `<span class="grip">↳</span>` |
| 731 | ↑ | `…="up" data-type="cat" data-id="${s.id}">↑</button>` |
| 732 | ↓ | `…down" data-type="cat" data-id="${s.id}">↓</button>` |
| 733 | ✎ | `…name" data-type="cat" data-id="${s.id}">✎</button>` |
| 734 | ✕ | `…"del" data-type="cat" data-id="${s.id}">✕</button>` |


### `admin/lab.html` (55 lines)

| Line | Emoji | Context |
|---:|---|---|
| 98 | 🎭 | `.scene > summary::before { content: '🎭 '; }` |
| 193 | ⚙ | `…" title="Re-run /api/init. Idempotent.">⚙️ Run migrations</button>` |
| 194 | 👤 | `…ors from its People tiles. Idempotent.">👤 Set up people</button>` |
| 197 | 🚀 | `…splay:flex;align-items:center;gap:4px;">🚀 Board:` |
| 201 | ← | `<a class="btn" href="/admin/">← Lab home</a>` |
| 209 | ✨→ | `…text-decoration:none;margin-left:10px;">✨ New Style wizard →</a></h2>` |
| 278 | ✨ | `… their prompts, then generate them all">✨ Review &amp; generate icons</button>` |
| 300 | ⭐ | `<option value="best">Has a best ⭐</option>` |
| 311 | ✨ | `…e, big/little) are generated together.">✨ Generate all filtered (batch)</button>` |
| 409 | 🖼✓ | `…anchor if unset)">${s.previewBlobKey ? '🖼 Preview ✓' : '🖼 Preview'}</button>` |
| 410 | ✕ | `<button data-act="delete">✕</button>` |
| 413 | 👤✓ | `…uilt default board">${s.personRefKey ? '👤 Person ✓' : '👤 Person'}</button>` |
| 414 | 🧸✓ | `…nder for this style">${s.stuffRefKey ? '🧸 Stuff ✓' : '🧸 Stuff'}</button>` |
| 415 | 🧩 | `…default board (review / bulk generate)">🧩 Defaults</button>` |
| 416 | ✨ | `…ne-button generate, progress, publish)">✨ Wizard</button>` |
| 443 | 🖼 | `…tn.disabled = false; btn.textContent = '🖼 Preview'; }` |
| 454 | 👤 | `…rld references (the default-board CMS): 👤 a generic child in` |
| 455 | 🧸 | `// this style; 🧸 an objects/materials scene. Same upload-then-PATCH dance` |
| 481 | 👤 | `refUpload('personref', 'personRefKey', '👤 Person');` |
| 482 | 🧸 | `refUpload('stuffref', 'stuffRefKey', '🧸 Stuff');` |
| 579 | ✕ | `…iority}</td><td class="actions"><button>✕</button></td>`;` |
| 650 | ⚠ | `? ('⚠ couldn’t load categories — ' + catLoadErr)` |
| 661 | ⚠✓ | `const status = r.parentMissing ? `⚠ need "${escapeHtml(r.parentLabel)}" first` : (r.hasImage ? '✓ ch…` |
| 666 | ⬆ | `…itle="Upload an image you already made">⬆</button>` |
| 667 | ✨ | `…isabled' : ''} title="Generate with AI">✨</button>` |
| 702 | ✨ | `… style="padding:6px 4px;color:#557fa3;">✨ generating "${escapeHtml(row.label)}"…</div>`;` |
| 719 | → | `// "Only missing or no image" checked → fill gaps. Unchecked → regenerate ALL` |
| 743 | ✨ | `if (btn) btn.textContent = `✨ Generating ${done + 1}-${Math.min(done + slice.length, toGen.length)}/…` |
| 763 | ✨ | `…tn.disabled = false; btn.textContent = '✨ Review & generate icons'; }` |
| 772 | ✓ | `…note.textContent = onBoard.image_key ? '✓ on board · image' : '✓ on board'; note.style.color = '#137…` |
| 773 | ⚠ | `else if (!catOk) { note.textContent = '⚠ make "' + (t.category \|\| '') + '" category first'; note.sty…` |
| 951 | ⬆ | `…eady made as a candidate for this tile">⬆ Upload image</button>` |
| 953 | ★🚀 | `…ct="publish" title="Publish this tile's ★ best image LIVE to the board">🚀 Push live</button>` |
| 954 | ★🖼 | `…publish-default" title="Set this tile's ★ best image as the shared DEFAULT (generic board) — every c…` |
| 955 | ⬇ | `…existing board image in as a candidate">⬇ Port from board</button>` |
| 968 | ✨ | `<button class="go" data-act="scene-go">✨ Generate scene</button>` |
| 1062 | ★☆ | `…ar" title="Mark best">${g.markedBest ? '★' : '☆'}</button>` |
| 1063 | ✕ | `<button class="del" title="Delete">✕</button>` |
| 1103 | ⚠→ | `if (note) { note.textContent = '⚠ person tile · no anchor → generic'; note.style.color = '#9a6700'; …` |
| 1125 | ✓ | `const anchor = p.reference_key ? ' ✓anchor' : ' (no anchor)';` |
| 1152 | → | `…n>' : '<span class="tag warn">no anchor → generic</span>'; }` |
| 1153 | ✓ | `… = s.blobKey ? '<span class="tag">photo ✓</span>' : '<span class="tag warn">choose a photo</span>';` |
| 1161 | ✕ | `… class="x" title="remove" data-subj-del>✕</button>`;` |
| 1174 | ✓ | `…he photo tag ("choose a photo" / "photo ✓") doubles as the file picker trigger` |
| 1231 | ★ | `…pears in the strip; review it and click ★ to make it canonical` |
| 1245 | ★ | `…d image is now a candidate — review and ★ it` |
| 1246 | ⬇ | `flashStatus(status, '⬇ ported board image', 'saved-flash');` |
| 1257 | ★ | `…kedBest)) { flashStatus(status, 'mark a ★ best image first', 'err-flash'); return; }` |
| 1261 | 🚀 | `flashStatus(status, r.created ? `🚀 live on ${childId}` : `🚀 updated on ${childId}`, 'saved-flash');` |
| 1281 | ★ | `…kedBest)) { flashStatus(status, 'mark a ★ best image first', 'err-flash'); return; }` |
| 1285 | 🖼 | `flashStatus(status, '🖼️ set as default', 'saved-flash');` |
| 1299 | ⚙ | `… { b.disabled = false; b.textContent = '⚙️ Run migrations'; }` |
| 1313 | → | `…       // refresh personsList + anchors → composer + flags update` |
| 1323 | ✓ | `…es = linked.map(p => `  ${p.anchored ? '✓' : '—'} ${p.label} — ${rel(p)}` +` |
| 1324 | ✓ | `(p.anchored ? `  [anchor ✓]` : (p.imageUrlSample ? `  [couldn't read image_url: ${p.imageUrlSample}]…` |


### `admin/style-wizard.html` (38 lines)

| Line | Emoji | Context |
|---:|---|---|
| 20 | ✓ | `.step.done h2::after { content:" ✓"; color:var(--ok); }` |
| 45 | ✨ | `<h1>✨ New Style wizard</h1>` |
| 49 | ← | `<a class="back" href="/admin/">← Lab home</a>` |
| 89 | 🧒 | `<h3>🧒 Demo kid (person reference)</h3>` |
| 92 | ✨ | `…ton class="secondary" data-gen="person">✨ Generate</button>` |
| 93 | 📤 | `… class="secondary" data-upload="person">📤 Upload</button>` |
| 94 | ✓ | `<button data-use="person" disabled>✓ Use this</button>` |
| 98 | 🧸 | `<h3>🧸 Objects (stuff reference)</h3>` |
| 101 | ✨ | `…tton class="secondary" data-gen="stuff">✨ Generate</button>` |
| 102 | 📤 | `…n class="secondary" data-upload="stuff">📤 Upload</button>` |
| 103 | ✓ | `<button data-use="stuff" disabled>✓ Use this</button>` |
| 119 | ➕ | `<h3>➕ Add a kid</h3>` |
| 126 | ✨ | `<button class="secondary" id="kid-gen">✨ Generate</button>` |
| 127 | 📤 | `…utton class="secondary" id="kid-upload">📤 Upload</button>` |
| 128 | ✓ | `<button id="kid-save" disabled>✓ Save kid</button>` |
| 141 | 🚀 | `<button id="go-generate">🚀 Generate the whole default board</button>` |
| 142 | ⚡ | `<button class="secondary" id="go-drain">⚡ Render a batch now</button>` |
| 160 | 🖼 | `…<button class="secondary" type="button">🖼 Open the gallery</button></a>` |
| 161 | 🌍 | `…<button class="secondary" type="button">🌍 Preview the demo board</button></a>` |
| 162 | 📣 | `<button id="go-publish" disabled>📣 Publish</button>` |
| 221 | ✓ | `…' + (saved ? '<div class="counts">Saved ✓</div>' : '<div class="counts">Candidate — approve it below…` |
| 235 | ♻ | `b.disabled = false; b.textContent = '♻️ Re-roll';` |
| 265 | ✓ | `…o kid' : 'Objects reference') + ' saved ✓', 'ok');` |
| 279 | ✅ | `(st.tilesDone >= st.tiles ? ' · ✅ on the practice board'` |
| 281 | 🚀 | `…tilesDone}/${st.tiles} rendered — press 🚀`);` |
| 286 | 🚀 | `…e="button" data-kid-jobs="' + k.id + '">🚀 Render their tiles</button>'` |
| 324 | ♻ | `b.disabled = false; b.textContent = '♻️ Re-roll';` |
| 355 | ✓🚀 | `setMsg('kids-msg', 'Saved ✓ — now 🚀 Render their tiles to put them on the practice board.', 'ok');` |
| 373 | ⚡ | `// launch gates). The ⚡ button renders a batch inline regardless.` |
| 391 | ✅ | `? '✅ Complete — review and publish below.'` |
| 393 | ⏸⚡→ | `? `⏸ ${waiting} queued but nothing has rendered in a few minutes — the every-minute cron may not be …` |
| 394 | 🚀 | `…se this tab.` : 'Idle — nothing queued. 🚀 Generate to fan out the work.')` |
| 395 | ⚠ | `+ (failedN ? ` ⚠️ ${failedN} failed (fix in the gallery, or re-run Generate to requeue).` : '');` |
| 397 | 🚀 | `…rate').textContent = STATUS.complete ? '🚀 Re-check for missing pieces' : '🚀 Generate the whole defau…` |
| 403 | ⚡ | `$('go-drain').textContent = '⚡ Rendering… (up to ~90s)';` |
| 408 | ⚡ | `setMsg('gen-msg', `⚡ Rendered ${d.processed} piece${d.processed === 1 ? '' : 's'}` + (d.failed ? ` (…` |
| 433 | 📣 | `setMsg('pub-msg', '📣 Live! It now shows in the onboarding picker and the demo\'s style switcher.', '…` |
| 483 | → | `…on class="secondary" type="button">Open →</button></a>'` |


### `admin/taxonomy.html` (38 lines)

| Line | Emoji | Context |
|---:|---|---|
| 180 | 📚 | `<h1>📚 Taxonomy</h1>` |
| 184 | ⚙ | `…ny missing tables/columns. Idempotent.">⚙️ Run migrations</button>` |
| 187 | 📥 | `…ry-run preview before anything writes.">📥 Merge batch…</button>` |
| 188 | 🔗 | `…ting tiles to canonical taxonomy slugs">🔗 Backfill slugs…</button>` |
| 189 | 🖼 | `… instead of generating them per-child.">🖼️ Default images…</button>` |
| 190 | 🔎 | `… word-tiles for anything personalized.">🔎 Default board</a>` |
| 191 | 🧰 | `…voices, re-arms dead jobs. Idempotent.">🧰 Build board…</button>` |
| 192 | ⬜ | `… older boards with stray aspect flags.">⬜ Square tiles…</button>` |
| 193 | 🧠 | `…I is configured, mechanical otherwise.">🧠 Index objects…</button>` |
| 212 | → | `…set-phase" data-val="v1_core">Set phase → v1_core</button>` |
| 213 | → | `…phase" data-val="v1_extended">Set phase → v1_extended</button>` |
| 214 | → | `…act="set-phase" data-val="v2">Set phase → v2</button>` |
| 215 | → | `…="set-phase" data-val="later">Set phase → later</button>` |
| 217 | ✓ | `…ct="set-core" data-val="true">Mark core ✓</button>` |
| 220 | → | `…ge" data-val="stage_1">Set growth_stage → stage_1</button>` |
| 221 | → | `…ge" data-val="stage_2">Set growth_stage → stage_2</button>` |
| 222 | → | `…ge" data-val="stage_3">Set growth_stage → stage_3</button>` |
| 223 | → | `…ge" data-val="stage_4">Set growth_stage → stage_4</button>` |
| 224 | → | `…data-val="stage_5plus">Set growth_stage → stage_5plus</button>` |
| 227 | → | `…" data-val="12-18m">Set acquisition_age → 12-18m</button>` |
| 228 | → | `…" data-val="18-30m">Set acquisition_age → 18-30m</button>` |
| 229 | → | `…ge" data-val="2-3y">Set acquisition_age → 2-3y</button>` |
| 230 | → | `…ge" data-val="3-4y">Set acquisition_age → 3-4y</button>` |
| 231 | → | `…age" data-val="4y+">Set acquisition_age → 4y+</button>` |
| 239 | ← | `<a class="btn secondary" href="/admin/">← Lab home</a>` |
| 240 | ← | `<a class="btn secondary" href="/">← Back to app</a>` |
| 510 | → | `…aque holophrases — e.g. "a big fat owl" → "we are driving somewhere"'></textarea>` |
| 542 | → | `Aliases: <code>name→label</code>, <code>mode→subject_mode</code>, <code>behavior→parent_photo_behavi…` |
| 869 | → | `…t ok = confirm(`Rename id ${editing.id} → ${newId}? Any downstream references will break.`);` |
| 932 | 🗣 | `formatter: (cell) => cell.getValue() ? '🗣️' : '', tooltip: 'Whole-phrase gestalt tile' },` |
| 936 | 👪🧑⚕🏫👴 | `return { parent: '👪', therapist: '🧑‍⚕️', school_team: '🏫', family: '👴' }[v] \|\| v;` |
| 939 | 📝 | `…l.getValue() === 'personal_skeleton' ? '📝 skeleton' : '',` |
| 942 | ✓ | `…) => cell.getValue() === false ? '—' : '✓' },` |
| 1049 | ✅ | `… indexed — the magic has full coverage. ✅';` |
| 1141 | → | `<td>→ <code>${escapeHtml(r.slug)}</code></td>`)}` |
| 1189 | ⚙ | `…tn.disabled = false; btn.textContent = '⚙️ Run migrations';` |
| 1398 | → | `.map((m) => `  ${m.from} → variants onto "${m.id}"`).join('\n');` |
| 1636 | → | `// Group by column → category → subcategory.` |


### `admin/defaults.html` (24 lines)

| Line | Emoji | Context |
|---:|---|---|
| 40 | → | `/* ── Board-like layout: column → category → subcategory ───────────── */` |
| 78 | 📁 | `.card.chip .word::before { content:'📁 '; font-weight:400; }` |
| 79 | → | `/* Missing image → amber. Failed → red. Personalized (generic mode) → gray dashed. */` |
| 140 | 🖼 | `<h1>🖼️ Default board</h1>` |
| 144 | ⚠👤🧸 | `… class="chip-warn" id="ref-warn" hidden>⚠️ upload 👤/🧸 refs on the Lab style card for best results</s…` |
| 154 | ↻ | `<button id="refresh">↻ Refresh</button>` |
| 155 | ➕ | `…ptionally store-only, free or credits.">➕ New board</button>` |
| 156 | ⬆ | `…g entries are copied — safe to re-run.">⬆️ Push from reference</button>` |
| 157 | 🎨 | `… every tile that doesn't have one yet.">🎨 Generate missing tiles</button>` |
| 158 | 🎨 | `…tegory chip that doesn't have one yet.">🎨 Generate missing chips</button>` |
| 159 | ♻ | `…or this style, replacing existing art.">♻️ Regenerate ALL</button>` |
| 160 | ← | `…lass="back" href="/admin/taxonomy.html">← Taxonomy</a>` |
| 161 | ← | `<a class="back" href="/admin/">← Lab home</a>` |
| 177 | ➕ | `<h3>➕ New board</h3>` |
| 239 | → | `…ap();        // 'section\|category_norm' → {storeOnly, pricing} (Lab board catalog)` |
| 297 | 🎨 | `…age in the selected style" ' + data + '>🎨</button>';` |
| 304 | 📤 | `…s default" data-id="' + esc(taxId) + '">📤</button>';` |
| 346 | → | `// ── Render: column sections → category groups → subcategory sub-groups ─` |
| 353 | → | `// Group tiles by column → category → subcategory, preserving server order.` |
| 430 | 📁 | `'📁 <b>' + cDone + '</b>/' + CHIPS.length + ' folder icons' +` |
| 533 | 🎨 | `progress.textContent = '🎨 ' + kind + ': ' + r.next + ' of ' + total +` |
| 550 | ✓ | `progress.textContent = '✓ Done — ' + parts.join(' · ');` |
| 553 | ✗ | `progress.textContent = '✗ ' + (e.message \|\| e);` |
| 691 | 🎨 | `…the taxonomy — generate images with the 🎨 buttons` |


### `admin/support.html` (16 lines)

| Line | Emoji | Context |
|---:|---|---|
| 55 | 🛟 | `<h1>🛟 Support inbox</h1>` |
| 62 | ↻ | `<button id="refresh">↻ Refresh</button>` |
| 65 | ← | `<a class="back" href="/admin/">← Lab home</a>` |
| 84 | ↗ | `…k" rel="noopener">Open parent dashboard ↗</a>` |
| 85 | ↗ | `…="_blank" rel="noopener">Open kid board ↗</a>` |
| 88 | ▶ | `<button class="primary" id="btn-start">▶ Start review (notifies the family)</button>` |
| 89 | 👀 | `<button id="btn-diff">👀 Preview changes</button>` |
| 90 | ✔→ | `<button class="warn" id="btn-finish">✔ Finish review → draft summary</button>` |
| 97 | 💾 | `<button id="btn-save">💾 Save draft</button>` |
| 98 | 📨 | `<button class="primary" id="btn-send">📨 Send response &amp; resolve</button>` |
| 140 | 🎉 | `…esc(status) + '”' : '') + ' — quiet day 🎉</td></tr>';` |
| 165 | ▶✓ | `…').textContent = CUR.reviewStartedAt ? '▶ Review started ✓' : '▶ Start review (notifies the family)'…` |
| 187 | ✅ | `…dy started (no second notice sent).' : '✅ Review started — the family has been notified. Edit their …` |
| 208 | 📝 | `$('status').textContent = '📝 Draft generated — edit it, add context, then send.';` |
| 216 | 💾 | `$('status').textContent = '💾 Draft saved.';` |
| 227 | 📨 | `$('status').textContent = '📨 Sent — the family will see it on their next visit.';` |


### `admin/reports.html` (14 lines)

| Line | Emoji | Context |
|---:|---|---|
| 51 | 📈 | `<h1>📈 Reports</h1>` |
| 57 | ↻ | `<button id="refresh">↻ Refresh</button>` |
| 60 | ← | `<a class="back" href="/admin/">← Lab home</a>` |
| 68 | ⬇ | `<button class="csv" data-csv="boards">⬇ CSV</button></div>` |
| 84 | ⬇ | `<button class="csv" data-csv="logins">⬇ CSV</button></div>` |
| 90 | ⬇ | `…button class="csv" data-csv="purchases">⬇ CSV</button></div>` |
| 97 | ⬇ | `…tton class="csv" data-csv="fulfillment">⬇ CSV</button></div>` |
| 159 | ⭐ | `…"><b>' + s.purchases + '</b>purchases · ⭐' + s.purchasedCredits + ' · ' + money(s.purchasedCents) + …` |
| 178 | ⭐ | `…t + ' in the last ' + s.days + ' days · ⭐' +` |
| 182 | ⭐ | `… esc(p.product) + '</td><td class="num">⭐' + p.credits + '</td><td class="num">' + money(p.cents) + …` |
| 188 | ⭐ | `…<td class="num">' + (f.boughtCredits ? '⭐' + f.boughtCredits + ' · ' + money(f.boughtCents) : '—') +…` |
| 189 | ⭐ | `'<td class="num">' + (f.spentCredits ? '⭐' + f.spentCredits : '—') + '</td>' +` |
| 230 | 🎉 | `…paused, nobody spending unusually fast. 🎉</td></tr>');` |
| 266 | ✓ | `$('role-msg').textContent = r.ok ? '✓ ' + d.role : (d.error \|\| 'failed');` |


### `admin/layout.html` (12 lines)

| Line | Emoji | Context |
|---:|---|---|
| 68 | ↕ | `<h1>↕️ Board layout</h1>` |
| 72 | ↩ | `…aved drags and reload the saved order.">↩ Undo all</button>` |
| 74 | → | `…"/admin/publish.html">Publish to boards →</a>` |
| 75 | ← | `…lass="back" href="/admin/defaults.html">← Default board</a>` |
| 76 | ← | `<a class="back" href="/admin/">← Lab home</a>` |
| 81 | ☰ | `…r><span style="color:#9d4d75;">Drag the ☰ rows to reorder. Click a category or subcategory to open i…` |
| 117 | → | `…t LISTS = new Map();          // listId → the array that list renders (rebuilt each render)` |
| 134 | ☰ | `… class="handle" title="Drag to reorder">☰</span><span class="name">${esc(w.label)}</span>` |
| 152 | ☰ | `… class="handle" title="Drag to reorder">☰</span>` |
| 179 | ☰ | `… class="handle" title="Drag to reorder">☰</span>` |
| 220 | ☰ | `…subcategory row, but not while grabbing ☰) ──` |
| 328 | ✓ | `msg.innerHTML = '<span class="ok">Saved ✓ — new boards will build in this order.</span>';` |


### `admin/publish.html` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 50 | 📣 | `<h1>📣 Publish to boards</h1>` |
| 54 | ← | `<a class="back" href="/admin/">← Lab home</a>` |
| 88 | 🙋 | `<span><b>🙋 Ask families to approve instead (recommended)</b><span class="sub">No board changes now: …` |
| 96 | ⚠ | `<span><b>⚠️ Also overwrite family-arranged boards</b><span class="sub">Explicit override: pushes the…` |
| 208 | ⚠ | `? '\n\n⚠️ OVERRIDE IS ON: boards the family deliberately rearranged will be overwritten too. Their c…` |
| 235 | ✓ | `say(`✓ ${r.childId} — ${bits.join(' · ')}`);` |


### `admin/tile-lab.html` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 6 | → | `<title>Add-Tile Lab — photo → tile pipeline</title>` |
| 41 | 🧩 | `<h1>🧩 Add-Tile Lab</h1>` |
| 42 | → | `…iPad runs (style guide attached, people → keystone portrait, things → nano). Retries send the RESULT…` |
| 43 | ← | `…0;font-size:14px;text-decoration:none;">← Lab home</a>` |
| 59 | → | `(mother → adult) or the capture UI's kid/grown-up toggle. -->` |
| 92 | ↻ | `…n class="btn ghost" id="retry" disabled>↻ Retry from result</button>` |


### `admin/portrait-lab.html` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 37 | 🎨 | `<h1>🎨 Portrait Lab</h1>` |
| 39 | ← | `…0;font-size:14px;text-decoration:none;">← Lab home</a>` |
| 55 | → | `…ives this from the relationship (mother → adult) or the` |


## 4 · API strings (check which reach users: emails, error messages) — 286 lines across 96 files


### `api/init.js` (16 lines)

| Line | Emoji | Context |
|---:|---|---|
| 80 | → | `//   'location' → a place (Home, Grandma's). Tap a location chip and the` |
| 82 | → | `//   'room'     → a room (Kitchen, Bedroom). Short-press speaks its name;` |
| 86 | → | `// "Places" tree (Places → Home → Kitchen → toaster) without nesting` |
| 177 | ↔→ | `// ---- Parent ↔ therapist handshake: an invite (parent → therapist) or a` |
| 178 | → | `// request (therapist → parent). Accepting it creates the child_access row. ----` |
| 338 | → | `… NULL DEFAULT 1,                -- 1..5 → 10/20/30/40/50 ceiling` |
| 422 | ↔ | `…-- Live session room (facilitator phone ↔ tablet, polled) ----` |
| 539 | → | `//   'universal'   → everyone (the standard library tile, e.g. apple)` |
| 540 | → | `//   'parent'      → presented to parents during onboarding / "add favorites"` |
| 541 | → | `//   'therapist'   → presented to therapists in their custom-board flow` |
| 542 | → | `//   'school_team' → presented to teachers / aides authoring class boards` |
| 543 | → | `//   'family'      → extended family (grandparents on the people roster)` |
| 545 | → | `//   'canonical'         → fully-generated standard tile content (apple, monkey)` |
| 546 | → | `//   'personal_skeleton' → no canonical image; just a label + guidance that` |
| 575 | → | `// voice). NULL = no default yet → fall back to per-child generation.` |
| 1103 | → | `// Reports → Spend guard. sub_canceled_at records Stripe cancellations.` |


### `api/admin/_lab-style-wizard.js` (14 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `… up a new offered style = upload anchor → approve a generated demo` |
| 5 | → | `// kid (person ref) + stuff ref → one button fans the whole default board out` |
| 7 | → | `// the tab can close) → review → Publish flips the style live in the` |
| 10 | → | `//   GET  ?styleGuideId=N            → { style, status } (progress poll)` |
| 11 | → | `…{ styleGuideId, op:'person-candidate' } → { key } generated demo-kid` |
| 12 | → | `…{ styleGuideId, op:'stuff-candidate' }  → { key } generated objects scene` |
| 13 | → | `…-ref', kind:'person'\|'stuff', blobKey } → save ref` |
| 14 | → | `…{ styleGuideId, op:'create-jobs' }      → fan out tiles+chips (gap-fill)` |
| 15 | → | `…{ styleGuideId, op:'publish', active }  → go live (requires 100%) / unpublish` |
| 19 | → | `…yleGuideId, op:'kid-candidate', hint? } → { key } generated kid` |
| 20 | → | `…op:'kid-save', label, blobKey, kidId? } → add/update a kid` |
| 21 | → | `…{ styleGuideId, op:'kid-jobs', kidId }  → queue that kid's person-scope tiles` |
| 22 | → | `… styleGuideId, op:'kid-remove', kidId } → deactivate (art kept)` |
| 146 | ⚡ | `// "⚡ Render a batch now" — one inline, bounded drain so a slow or` |


### `api/_lib/seed-board.js` (12 lines)

| Line | Emoji | Context |
|---:|---|---|
| 15 | → | `…hes the same way tile_jobs does: queued → processing →` |
| 65 | → | `*  - no art / default art            → yes` |
| 66 | → | `*  - custom art, styled_style_id NULL → no (grandfathered: personalized before` |
| 68 | → | `*  - custom art under another guide  → yes (style changed → stale)` |
| 106 | ✨ | `// saw "re-rendering ✨", and nothing ever landed or archived.` |
| 318 | ⭐ | `// The bundle: every render-scope tile (⭐1 each) + the two up-front family` |
| 319 | ⭐ | `// portraits (⭐5 each), charged ONCE per child as` |
| 321 | ⭐ | `// Plus (⭐50) always pays its full grant for the ~⭐120-value build (a` |
| 322 | ⭐ | `…welcome deal, balance lands on 0); Pro (⭐150) pays the actual` |
| 341 | ⭐ | `…floor: Pro's enrollment leaves at least ⭐enrollKeep behind` |
| 342 | ⭐ | `// (⭐50 today) so the family lands with spending money, not zero.` |
| 426 | → | `// Non-English board → clips must SPEAK the child's language (display is` |


### `api/admin/_lab-support.js` (10 lines)

| Line | Emoji | Context |
|---:|---|---|
| 6 | → | `//   Start review  → snapshots the board + notifies the family in-app` |
| 9 | → | `//   Finish review → diffs snapshot vs now into a bulk change summary DRAFT` |
| 10 | → | `//   Send response → finalizes the message (family sees it verbatim as their` |
| 13 | → | `//   GET                              → { cases, counts }        (?status= filter)` |
| 14 | → | `//   GET  &id=123                     → full case` |
| 15 | → | `//   GET  &id=123&op=diff             → live diff preview (nothing saved)` |
| 16 | → | `//   POST { op:'start',  id }         → stamp + snapshot + notice` |
| 17 | → | `//   POST { op:'finish', id }         → save generated draft (replaces draft!)` |
| 18 | → | `//   POST { op:'draft',  id, text }   → save manual draft edits` |
| 19 | → | `//   POST { op:'send',   id, text? }  → finalize + resolve (409 if already sent)` |


### `api/store.js` (9 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `…childId, taxonomyIds:[] } spend credits →` |
| 14 | → | `…POST ?action=stripe-checkout    { sku } → Stripe Checkout session URL (web)` |
| 207 | → | `// Time-bound comps: days = 7\|30\|90\|… → the override expires by itself;` |
| 302 | → | `// Checkout: each word = 1 credit → the word is placed on the board (if missing)` |
| 318 | ⭐ | `…le category/subcategory at once) — same ⭐1/word` |
| 517 | ⭐ | `…nalization status — one call for every "⭐N to finish"` |
| 557 | → | `// GET ?action=impact&childId=&word=  →` |
| 600 | → | `// GET ?action=followups&childId= →` |
| 826 | ⭐ | `… One FREE retry per tile, then credits (⭐1; people photo tiles ⭐5 — the` |


### `api/_lib/onboarding-render.js` (8 lines)

| Line | Emoji | Context |
|---:|---|---|
| 43 | → | `// No style chosen → fall back to the first active GLOBAL template.` |
| 49 | ⇒ | `…-migration fallback: no child_id column ⇒ no family guides exist,` |
| 55 | → | `…lob_key); } catch (_) { /* missing blob → heal below */ } }` |
| 72 | → | `// 2) legacy public storage URL → fetch the bytes, re-home them under a` |
| 175 | → | `…up` comes from the relationship (mother → adult) or the capture` |
| 212 | → | `"FRAMING: one person → a centered head-and-shoulders portrait. A group → frame everyone together fro…` |
| 393 | → | `… TTS voice id from child_settings (null → caller default).` |
| 448 | → | `} catch (_) { /* miss → generate */ }` |


### `api/admin/_lab-generate.js` (8 lines)

| Line | Emoji | Context |
|---:|---|---|
| 74 | → | `…).slice(0, 64).trim();  // board target → resolve subject anchors` |
| 120 | → | `…ted = false;   // a person was expected → caller can warn if no anchor` |
| 133 | → | `} catch (_) { /* anchor unreadable → fall back to generic */ }` |
| 142 | → | `// {family_adult} → a close family member's likeness anchor. Body parts and` |
| 147 | → | `// adult → the child's own anchor → a generic unnamed adult, so the tile` |
| 164 | → | `} catch (_) { /* unreadable anchor → generic adult */ }` |
| 171 | → | `// {reference} → the named subject when we have an anchor, else a generic child so the` |
| 175 | → | `// {family_all} → generic phrasing for whole-family scenes (event tiles like` |


### `api/admin/_taxonomy-snapshots.js` (8 lines)

| Line | Emoji | Context |
|---:|---|---|
| 3 | → | `//   GET                              → list (no payload, keeps response light)` |
| 4 | → | `//   GET   ?id=N&full=1               → fetch one with payload` |
| 5 | → | `//   POST  { label, note }            → create a snapshot of the current state` |
| 6 | → | `//   POST  ?id=N&action=restore       → restore (auto-creates a pre-restore snapshot)` |
| 7 | → | `//   DELETE ?id=N                     → delete (immutable to edit, deletable)` |
| 46 | → | `// diff=1 → compare snapshot's payload to the current taxonomy and` |
| 89 | → | `// POST?action=restore&id=N → replace taxonomy with the snapshot's contents.` |
| 137 | → | `// POST → create a snapshot of the current state.` |


### `api/_lib/relationships.js` (7 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `//   side    → ask maternal/paternal (e.g. which grandma)` |
| 8 | → | `//   sibling → uses birth_order; multiples display as "Brother 1", "Brother 2"…` |
| 9 | → | `//   self    → the child themselves (persons.is_self)` |
| 10 | → | `//   age     → 'adult' \| 'child' when the relationship pins it down; ABSENT when` |
| 15 | → | `//   ageDefault → the picker's pre-selection for ambiguous entries (siblings` |
| 69 | → | `…mother', side:'maternal' }              → "your grandma on your mom's side"` |
| 70 | → | `…er' } + { siblingQualifier:'little' }   → "your little brother"` |


### `api/parent/style.js` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `//   GET                       → { styleGuide, styles }` |
| 9 | → | `…   child_settings.settings.styleGuideId → the child's own family guide` |
| 10 | → | `//         → null). Includes per-kind reference URLs (main / person / stuff).` |
| 13 | → | `//       → streams that reference image. Gated: the guide must be a public` |
| 16 | → | `//       → point the child at a template (or back at their family guide).` |
| 18 | → | `//       → set one reference on the child's OWN family guide (created as a` |


### `api/admin/_lab-seed-defaults.js` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 53 | → | `// Map of normalized label → the single default-able taxonomy row with that label.` |
| 110 | ★ | `//   2. the Lab's ★ marked-best generation for that row (already generated,` |
| 113 | → | `… (e.g. "train" in Vehicles and in Toys) → reuse its key` |
| 120 | ★ | `… available Lab generation per tile: the ★ starred one first, then the` |
| 138 | → | `…faultKeyByLabel = new Map();   // label → an already-set default key` |
| 240 | → | `// Fallback: not slug-linked → match by label to default-able rows that have a` |


### `api/admin/_lab-voices.js` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | → | `//   GET → { voices:[{id,name,gender,accent,active,sortOrder}] }   (incl. inactive)` |
| 10 | → | `…   POST { id, name?, gender?, accent? } → add. When name is omitted we ask` |
| 42 | → | `…Voices: Read" permission. In ElevenLabs → '` |
| 43 | → | `+ 'Developers → API Keys, edit the key and enable Voices read (TTS keeps working either way).';` |
| 69 | ✓ | `// Listen-and-confirm QC marks: one ✓ per (voice, word). Persisted server-side` |
| 102 | ✓ | `…ench queues (non-archived rows), so the ✓ set` |


### `api/_lib/tile-jobs.js` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 11 | → | `// Status flow:  queued → processing → done \| failed   (failed is retried by the` |
| 59 | → | `// raw = TRUE → use the photo AS-IS as the tile (no AI restyle, no charge).` |
| 64 | → | `…ship itself decides when it can (mother → adult).` |
| 181 | → | `} catch (_) { /* missing ref → style scene alone still anchors the look */ }` |
| 267 | → | `…n the child's chosen voice (best-effort → system voice fallback).` |


### `api/_lib/word-match.js` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 12 | → | `//   love → loves, loving, loved        cry → cries, crying, cried` |
| 13 | → | `//   run  → runs, running, ran (irregular map)` |
| 14 | → | `//   hug  → hugs, hugging, hugged (CVC doubling)` |
| 17 | → | `// Nonsense variants ("no" → "noed") are harmless: they only match if someone` |
| 22 | → | `// Irregular inflections (base → variants). Curate freely; keep base-form keys.` |


### `api/admin/_lab-generate-scene.js` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 13 | → | `…ts: [                 // ordered; index → role A,B,C…` |
| 39 | → | `…(i) => String.fromCharCode(65 + i); // 0→A, 1→B…` |
| 76 | → | `// 3. Resolve each subject's source → { role, label, buf\|null, key\|null, note }.` |
| 111 | → | `…-missing'; key = null; } // anchor gone → fall back to text for this subject` |
| 212 | → | `// 8. Save PNG → Blob, then into tile_generations (the QC strip) + image_generations (cost log).` |


### `api/persons.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `…GET    /api/persons?childId=            → { persons: [...] }` |
| 6 | → | `…POST   /api/persons   (JSON body)       → create/update a person; the linked` |
| 9 | → | `…ELETE /api/persons?id=&childId=         → remove the person row (tile is left as-is).` |
| 54 | → | `…elationship decides when it can (mother → adult); the client's` |


### `api/_lib/milestones.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 163 | → | `…record(db, childId, 'combo', `combo:${a}→${b}`, payload, t.occurredAt)) {` |
| 199 | 🎉 | `…ether for the first time: “${m.phrase}” 🎉`` |
| 201 | 🎉 | `…ame} chained three words: “${m.phrase}” 🎉`` |
| 202 | 📚 | `… ${m.mark} different words on the board 📚`;` |


### `api/_lib/access.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `//   - admin            → every child.` |
| 5 | → | `//   - parent/therapist → the children they have an ACTIVE row for in child_access.` |
| 73 | → | `…hared/parent-board content (owner NULL) → only parent of the child.` |
| 75 | → | `// Therapist-owned content → owner OR a parent of the child (parent override).` |


### `api/_lib/credits.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 71 | ⭐ | `…mps to balance - enrollKeep). Pro keeps ⭐50 so a` |
| 74 | ⭐ | `// build (a ~⭐120 value for ⭐50).` |
| 150 | → | `…omer id (saved by the checkout webhook) → powers the billing` |
| 417 | → | `…      (two users grabbing the last slot → exactly one wins; the loser's` |


### `api/_lib/support.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `// inside a snapshotted start→finish window, and the family receives a bulk` |
| 50 | → | `// Minimal board snapshot for the start→finish diff: only the fields the` |
| 51 | → | `// summary talks about. ~100 bytes/tile → a 1000-tile board is ~100 KB JSONB.` |
| 99 | → | `… reorderByCat = new Map();     // catId → [labels] moved within the folder` |


### `api/parent/style-regenerate.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `//   action=draft  → generate a fresh take in the current style; return { draftKey }.` |
| 8 | → | `//   action=commit { draftKey } → make it the lasting family style anchor: update` |
| 12 | → | `// Draft→commit so a worse take never silently replaces the working anchor.` |
| 35 | → | `// /api/parent/style): pinned pointer → child-scoped family guide → none.` |


### `api/admin/_taxonomy-import-csv.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `…l match (case-insensitive, same column) → SKIP the new row and` |
| 8 | → | `//   • exact id match → skip entirely (re-run safe)` |
| 9 | → | `//   • everything else → INSERT as status='draft' so nothing goes live until` |
| 21 | → | `…ariants arrive piped or comma-separated → match_terms text[]` |


### `api/admin/_lab-publish.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 22 | → | `…ll\|style\|child &styleGuideId= &child=   → dry-run preview` |
| 25 | → | `//        → processes a chunk of boards; { results, nextOffset, total, done }.` |
| 136 | → | `// Non-English board → push clips in ITS language. This is also how an` |
| 148 | → | `…byKey = new Map();   // target soundKey → { text, ids:[…] }` |


### `api/admin/_lab-style-defaults.js` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 12 | → | `//     → { style, tiles:[{id,label,column,category,subcategory,defaultable,` |
| 16 | → | `//     → chunked bulk generation; loop until done:true (defaults.html drives it).` |
| 17 | → | `…Id, op:'regen', taxonomyId }            → re-render one tile` |
| 18 | → | `…:'regen', chip:{section,label,parent} } → one chip` |


### `api/play-request.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 2 | → | `//   POST  → stamp the request + push the child's parents ("… wants to play!")` |
| 3 | → | `//   GET   → { at, ageSec }  so an open parent dashboard can show a banner too` |
| 50 | 🎮 | `title: name + ' wants to play! 🎮',` |


### `api/demo.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 72 | → | `…;   // "section\|label_norm\|parent_norm" → sort` |
| 111 | → | `…gration DB: no demo_child_id column yet → every row is kid 0` |
| 202 | → | `// Demo voices built by Lab → demo-audio (deterministic clip keys:` |


### `api/analytics.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 54 | → | `… - 1) - b; // bucket 0 = current period → last slot` |
| 69 | ▶ | `…                  // Sentence activity: ▶ presses of the builder` |
| 280 | ▶ | `// ---- SENTENCE ACTIVITY: every ▶ press of the sentence builder ----` |


### `api/items.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 29 | → | `// ?lexicon=1 → the canonical suggestion matcher vocabulary (#10).` |
| 146 | → | `finalKey = key;   // copy failed → old behavior (better than blocking the revert)` |
| 177 | → | `// Permission. Child-scoped → parent-of-child / admin. Template → owner / admin.` |


### `api/interactions.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 3 | → | `…, kind, prompt, response, scheduleId }  → log one answer` |
| 4 | → | `//   GET  ?childId=&limit=   → recent answers, newest first (parent dashboard)` |
| 51 | → | `… answered', body: ((prompt ? prompt + ' → ' : '') + (response \|\| '')).slice(0, 178), data: { kind: '…` |


### `api/_lib/style-build.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 70 | ⇔ | `/// PERSON-SCOPE ⇔ the tile draws the child, so it varies per demo kid.` |
| 328 | → | `const styles = new Map();   // style id → style row (or null)` |
| 329 | → | `…nchors = new Map();  // "styleId:kidId" → child anchor image (or null)` |


### `api/_lib/auto-teach.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 49 | → | `// Cadence → micro-exposure spacing + daily budget.` |
| 56 | → | `// Tier → session-length cap (drives game length too).` |
| 98 | → | `} catch (_) { /* bad tz string → server time */ }` |


### `api/admin/_lab-spend-guard.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `//   GET                       → { blocked: [...], hot: [...] }` |
| 11 | → | `//   POST { op:'unblock', userId }   → clears the pause` |
| 12 | → | `… POST { op:'block',   userId, reason? } → manual pause (same flag)` |


### `api/admin/_taxonomy-prompt-versions.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 3 | → | `//   GET  ?id=<taxonomyId>            → every prior prompt we can find for the tile:` |
| 11 | → | `…/                                       → set the tile's prompt to `prompt`, after` |
| 53 | → | `// Merge all sources newest→oldest, collapsing runs of an identical prompt.` |


### `api/admin/_lab-role.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `//   GET  → { testers: [accounts with a non-parent role] }` |
| 9 | → | `//   POST { email, role } → set role ('parent' \| 'therapist' \| 'school_team'` |
| 57 | → | `// No account yet → store the grant; signup applies it.` |


### `api/auth/register.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 137 | → | `… 2 : n + 1; continue; }   // slug taken → next number` |
| 200 | 🌍 | `…redoka',system-ui;">Welcome to My World 🌍</h2>` |
| 204 | → | `…er-radius:999px;">Set up ${who}'s board →</a>` |


### `api/therapist/board-share.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `…caller is the template's owner OR admin → delete the share row outright.` |
| 5 | → | `…caller is a parent of the child         → soft-remove (status='removed').` |
| 7 | → | `//   - Other callers → 403.` |


### `api/onboarding/scene.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | → | `//   ?action=draft    → generate a scene in the working style (advanced Pro model),` |
| 11 | → | `//   ?action=retry  { attempt }  → regenerate with a small variance nudge.` |
| 12 | → | `//   ?action=commit { draftKey } → approve. Persists the scene as the lasting` |


### `api/onboarding/child.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 37 | → | `// Favorite color → the child's banner color everywhere (§1). Contrast is` |
| 39 | → | `…itrary picks stay readable (dark banner → white text, light → ink).` |
| 42 | → | `// Optional: boy/girl → pronoun. The child step captures exactly these two;` |


### `api/child-settings.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `//   GET  ?childId=            → { settings }` |
| 5 | → | `//   POST ?childId= { settings }  → replace the whole settings object` |


### `api/album.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `//   timeline → flat list, newest first, mixed across tiles` |
| 8 | → | `//   by-tile  → grouped by item (label + section), each with current + history` |


### `api/onboard-subject.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 39 | → | `…/ relationship when unambiguous (mother → adult); the explicit query param —` |
| 186 | → | `…rding picker sends it; until then child → self, grown-up → other.` |


### `api/skill-insights.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `…hildId=                                 → { insights: [...] }` |
| 5 | → | `…id, action: 'dismiss' }                 → therapist-only` |


### `api/sync.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 105 | → | `…gration DB: no demo_child_id column yet → every row is kid 0` |
| 242 | → | `// Board language ≠ English → attach displayLabel (never rewrite label:` |


### `api/generate-descriptions.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 85 | → | `…nd / relationship has no natural phrase → fall through to the model.` |
| 86 | → | `…/* missing persons table or query error → fall through to the model */ }` |


### `api/_lib/category-icons.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 126 | → | `// specific → bare sub → parent category → null (caller uses the generic prompt).` |
| 219 | → | `…row (find by child/section/parent/label → UPDATE else` |


### `api/_lib/event-dates.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 12 | → | `// MM-DD → key.` |
| 52 | → | `// floating[key](year) → Date for that year's instance` |


### `api/_lib/word-suggestions.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 10 | → | `…  { childId, slugs:[...] }        board → server (batched)` |
| 100 | → | `… the canonical matcher vocabulary (slug → label + variants) the` |


### `api/admin/_lab-publish-default.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 3 | ★ | `// Publish a Lab tile's ★ best image as the shared DEFAULT (generic-board) image` |
| 39 | ★ | `…({ error: 'No best image yet — mark one ★ in the Lab first.' });` |


### `api/admin/_lab-boards.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 18 | → | `//   GET → { boards:[{section,label,count,defaultables,storeOnly,pricing}] }` |
| 21 | → | `//     → creates taxonomy rows with the same conventions as the board importer` |


### `api/admin/_lab-demo-audio.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 12 | → | `//   GET                      → { voices, tiles, built: {voiceId: count} }` |
| 13 | → | `…   POST { op:'build', voiceIds:['..'] } → synth missing clips (≤ ~4 min)` |


### `api/admin/_lab-backup.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 6 | → | `//   GET  ?op=inventory        → blob-key census: every key referenced by the` |
| 12 | → | `//   GET  ?op=export&table=X&after=N → one table as NDJSON, paginated by id` |


### `api/admin/_lab-tile-lab.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 6 | → | `…ow runs (style-guide attachment, people → keystone-portrait` |
| 7 | → | `// branch, objects → nano), so what you see here is what a parent gets.` |


### `api/admin/_lab-layout.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | → | `//   GET → { columns: [{ section, categories: [{ label, parent:'', sort,` |
| 11 | → | `…abel,parent,sort}], tiles:[{id,sort}] } → { ok }` |


### `api/admin/keystone-model.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `//   GET → { current, available, fallback }` |
| 7 | → | `//   PUT { model } → persist as lab_settings.model_defaults.keystone (drives prod)` |


### `api/admin/_lab-default-upload.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `//     no styleGuideId → generic default: blob under taxonomy-defaults/ and` |
| 10 | → | `//     styleGuideId    → that style's default: blob under style-defaults/ and` |


### `api/admin/_lab-translations.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | → | `//   GET  ?lang=zh          → { entries, coverage } — every dictionary row plus` |
| 11 | → | `//   GET  ?lang=zh&csv=1    → text/csv export (en,section,category,zh,pron,status)` |


### `api/auth/apple.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 78 | → | `// Slugify a name → 'andrewpeterson'. Same shape the rest of the app uses.` |
| 183 | → | `…            // true = brand-new account → continue onboarding` |


### `api/cron/refresh-insights.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 56 | → | `…) goes tightened; mastered/recent-spike →` |
| 57 | → | `// standard. Stage 5 + no mastery → eval_flagged.` |


### `api/onboarding/styles.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 2 | → | `//   (no params)      → { styles: [{ id, label, description }] } for the picker` |
| 3 | → | `//   ?image=<id>      → streams that style guide's reference image (auth-gated)` |


### `api/onboarding/style-upload.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `//   • child_id = <childId>  → kept out of the global picker (api/onboarding/styles)` |
| 6 | → | `//   • ephemeral = TRUE      → discarded once the approved keystones take over as` |


### `api/onboarding/family.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 261 | → | `// Advance the step. child_photo → parent_photo → scene_keystone (the` |
| 262 | → | `// no-people style gate) → seed_core.` |


### `api/onboarding/state.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | ⭐ | `… onboarding "personal touches" bonuses: ⭐3 land when the favorite-foods` |
| 10 | ⭐ | `// step appears and ⭐3 at toys. Idempotent by ledger reason (onboard:foods /` |


### `api/style-guides/public.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 1 | → | `…GET /api/style-guides/public            → { styles: [{ id, label, description }] }` |
| 2 | → | `…ET /api/style-guides/public?image=<id>  → streams that guide's preview image` |


### `api/categories.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 39 | → | `// new order → i*1000). One board per call; parent-or-admin edits everything,` |


### `api/generate-image.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 235 | → | `…atch (_) { /* no style guide configured → text style only */ }` |


### `api/tile-jobs.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 14 | → | `…Auth-gated; the heavy lifting (describe → style-consistent art → voice →` |


### `api/manifest.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 13 | → | `…_{IOS,ANDROID}, APP_UPDATE_NOTE); unset → 0/null → gate off,` |


### `api/live.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `…/   GET  ?childId=                      → { status, payload, cmd, cmdSeq, age }` |


### `api/message-to-board.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 106 | → | `…nded match variants (loves/loving/loved → love).` |


### `api/celebrate.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 1 | → | `…api/celebrate?childId=&date=YYYY-MM-DD  → today's special-day events` |


### `api/square-tiles.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 21 | → | `// Tiles in a poster folder → rectangular; everything else → square.` |


### `api/advance-band.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 1 | → | `// GET  /api/advance-band?childId=  → { current, natural, advanced, next, readyToAdvance, mastery }` |


### `api/_lib/i18n.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 12 | → | `// section+category → section → category → bare label.` |


### `api/_lib/vision.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 1 | → | `…/ Shared OpenAI vision labeler: a photo → a 1-2 word, child-friendly AAC label.` |


### `api/_lib/onboarding.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 43 | → | `// Tier (attention budget) → auto-teach defaults. Used when seeding child_settings.` |


### `api/_lib/email.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 1 | → | `// Minimal Resend wrapper. One POST → /emails. Returns { ok, id?, error? }.` |


### `api/_lib/exposure.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 17 | → | `…                         // exposure 10 → +2 weeks` |


### `api/_lib/gemini.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `// https://aistudio.google.com → "Get API key".` |


### `api/_lib/batch-generate.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 44 | → | `…mp.sort();              // alphabetical → earlier word seeds later` |


### `api/_lib/i18n/pt.json` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `…peaker review — export the CSV from Lab → Translations.",` |


### `api/_lib/i18n/de.json` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `…peaker review — export the CSV from Lab → Translations.",` |


### `api/admin/taxonomy.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 47 | → | `// No fn (or the explicit crud aliases) → the GET/POST/PUT/DELETE row CRUD.` |


### `api/admin/_lab-port-image.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | ★ | `…odel='ported') so you can review it and ★ it as the` |


### `api/admin/_lab-batch-generate.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 78 | → | `…h([cid]);   // chips have no cross-deps → singleton groups` |


### `api/admin/_lab-onboarding-report.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | 🧰 | `// the admin should rescue (🧰 Build board / Apply defaults).` |


### `api/admin/_taxonomy-bulk.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 17 | → | `…ed` means "the import didn't supply it" → keep existing.` |


### `api/admin/_lab-reports.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `//   GET ?days=30 →` |


### `api/admin/_taxonomy-crud.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 290 | → | `…= newId !== old.id ? `renamed ${old.id} → ${newId}` : `updated ${old.id}`;` |


### `api/admin/_lab-upload-image.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | ★ | `…it next to the generated ones and click ★ to make` |


### `api/admin/board-tree.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 2 | → | `// Returns the (section → category → subcategory → item-count) tree for one` |


### `api/admin/_lab-publish-tile.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 39 | ★ | `…({ error: 'No best image yet — mark one ★ in the Lab first.' });` |


### `api/admin/backfill-taxonomy-slug.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 13 | → | `//   - One candidate → match. Zero → unmatched. Two+ → ambiguous (skipped).` |


### `api/admin/_lab-build-board.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 66 | ⚠ | `? ` ⚠️ PERSONAL RENDERS SKIPPED — the family's tier is ${build.ownerTier}; seed jobs queued voice-on…` |


### `api/auto-teach/next.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 53 | → | `// All gates. Any closed gate → refusal with a reason the iPad can log.` |


### `api/auth/reset-request.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 41 | → | `…er-radius:999px;">Choose a new password →</a>` |


### `api/onboarding/voices.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 1 | → | `// GET /api/onboarding/voices → { voices: [{ id, name, gender, accent }], sampleText }` |


## 5 · Docs, tooling & internal — 366 lines across 39 files


### `README.md` (92 lines)

| Line | Emoji | Context |
|---:|---|---|
| 15 | → | `…picker prioritizes unmet age-band words → longest-gap active → acquired-not-mastered → one stretch t…` |
| 25 | 🎙 | `…ard's lexicon). Startable two ways: a **🎙️ Listen button on the board itself** (opposite the Play bu…` |
| 27 | →▶ | `…s a durable **state machine** (`account → child → child_photo → parent_photo → scene_keystone → seed…` |
| 34 | → | `…, the server runs the whole chain (name → style-consistent art → voice → place on the board), and a …` |
| 36 | ▶ | `…oard voice** (an ElevenLabs voice, with ▶ previews); the grown-up step is **repeatable** (add the wh…` |
| 39 | → | `…or: rename, swap the picture (new photo → AI art or use as-is), keep-aspect, re-voice with an emotio…` |
| 40 | → | `…e folder, not a per-tile flag. Settings → "Make all tiles square" normalizes the stored `keep_aspect…` |
| 45 | ⭐ | `…er`, balance = SUM). Purchasable packs (⭐50–⭐1000) via Stripe on the web, StoreKit on iOS, Google Pl…` |
| 46 | → | `…(`entitlementFor`): admin comp override → admin role → active purchase → free.` |
| 47 | → | `…rship (`requireStyling` / `memberOr402` → HTTP 402 with an upsell payload). Free-tier CTAs on every …` |
| 61 | 🔑 | `… is lazily cleared). Plus per-account **🔑 password reset** (admin receives the reset URL directly — …` |
| 63 | 🚩 | `…arding step / image + seed counts, with 🚩 flags for "paid or credited but zero images", and per-row …` |
| 65 | ✨ | `… *Personalize all* and the per-folder **✨ Style** batch skip already-styled art (and re-eligibility …` |
| 70 | → | `… in dark launch; seeded/managed via Lab → Translations.` |
| 71 | →✏▶✕🎙📖🙋 | `…** (admin dark-launch, parent dashboard → Access): **button navigation** replaces every scroll with …` |
| 72 | → | `- **Touch controls** (parent-set, Board → Touch & safety): **taps interrupt** (default OFF — a child…` |
| 74 | →🚀⭐ | `…w offered style: upload one style image → approve a **generated demo kid** + objects reference (re-r…` |
| 76 | ✕ | `…S + Android): **quick-tap close** (game ✕ without the 1.2s child-proofing hold) and **password-free …` |
| 77 | 🖼 | `…odal AND the native iOS sheet) have a **🖼 Adjust framing** overlay — drag/zoom the photo inside a ti…` |
| 79 | 📤 | `…Curated default art without prompts** — 📤 direct upload on every defaults-view tile card writes the …` |
| 80 | ⚙ | `…localStorage-only stats, a session-only ⚙ Display modal (labels/sizes/sections/colors in sessionStor…` |
| 86 | ⭐ | `… for comps/grandfathering); Plus $9.99 (⭐50/mo) and Pro $19.99 (⭐150/mo) are the live tiers. No disc…` |
| 87 | ⭐ | `…). Plus invests its whole first month (~⭐120 value for ⭐50); Pro keeps at least ⭐50 (`enrollKeep`). …` |
| 91 | ⚙ | `… "queued"); child board's edit pill is "⚙ Settings" with sign-out inside; easy-unlock confirm copy c…` |
| 92 | ▶✏ | `… by moving tiles into the top bar, then ▶ speaks it (and logs it to the dashboard's Sentence activit…` |
| 93 | ⭐ | `…mily says" panel — Add (Word-Shop path, ⭐1), Dismiss (resurfaces on next hearing), or Never (per-chi…` |
| 101 | → | `… New parents \| Free self-service signup → guided onboarding (art style, voice, keystone portraits + …` |
| 122 | ⚙→ | `- ⚙ Display → "Default view for this device" changes the saved role on the spot.` |
| 134 | 🔒✎⚙ | `- **Edit mode** (parent unlocks via 🔒): per-tile ✎ badge, drag-to-reorder, plus a row of edit-only b…` |
| 135 | 🙋→ | `- **🙋 Play with me** button on the board: Fletcher taps it → calls `/api/play-request` → APNs push t…` |
| 136 | ⚙ | `- **⚙ Display** (per-device, in `localStorage`):` |
| 143 | ✕ | `… one exception to per-device: quick-tap ✕ and` |
| 147 | 🔒🙋 | `- Header layout: 🔒 lock (left) — MyWorld globe icon + "Fletcher's World" — 🙋 Play with me (right). A…` |
| 151 | →⚙ | `…n the tablet, launchable locally (board → ⚙ Play) or remotely (parent or therapist phone via `/api/l…` |
| 165 | → | `…omposes a multi-step routine (slideshow → game → celebration, any mix). The tablet runs the steps in…` |
| 167 | → | `…Matching game: end-celebration finishes → next step` |
| 168 | → | `- Celebration: ~4.4 s animation → next step` |
| 180 | ✓ | `…tablet to confirm**: "Started on tablet ✓", or a clear reason it didn't (too few picture tiles in th…` |
| 191 | ✎ | `- **✎ on any tile / category / subcategory** opens the **full Add/Edit modal** in edit mode: change …` |
| 194 | 📚🔊✋🧪🖼🗂✕ | `… into collapsed `<details>` accordions (📚 Words & look · 🔊 Voice & language · ✋ Touch & safety · 🧪 A…` |
| 196 | 🧬 | `- **Admin-only**: a `🧬 Taxonomy` link in the top-right opens the workbench at `/admin/taxonomy.html`…` |
| 244 | → | `…rolled out endpoint-by-endpoint** (sync → items/categories → live/child-settings → analytics/events)…` |
| 257 | 🧑 | `…d queue, up to 3 renders concurrent), **🧑 Parent app** (switch this device to the parent surface), a…` |
| 258 | → | `…ormed caption through `GameAudio.speak` → `SpeechCache`.` |
| 273 | 👆🗣🧸 | `…rect" progress, the three mark buttons (👆 Tapped · 🗣 Said · 🧸 Showed object — colors match the web),…` |
| 274 | → | `\| **Message the board** \| Text → `/api/message-to-board` → tokenized server-side against every tile …` |
| 277 | → | `\| **Album** \| `/api/album?mode=by-tile` → folder hub: **People · Words · Verbs · Celebrations**. Ope…` |
| 301 | ✨ | `…ble `tile-jobs` queue, and the one-tap "✨ Match my child's style".` |
| 317 | → | `…d's. The token resolves through `mother → father → step-parent → guardian → grandparent` with fallba…` |
| 349 | → | `…e picker priority: unmet age-band tiles → longest-gap active rotation → acquired-not-mastered → one …` |
| 355 | → | `…nAI gpt-image** (`_lib/openai-image.js` → `openaiEditImage` on `/v1/images/edits`), because OpenAI i…` |
| 365 | ⭐ | `….js`): five one-time packs (`credits50` ⭐50/$4.99 … `credits1000` ⭐1000/$99.99) and three monthly ti…` |
| 378 | → | `…ze-all` / `personalize-category` (quote → confirm batch styling with per-image dedup) · `impact` / `…` |
| 388 | → | `…shes `(model \| voice \| emotion \| text)` → sha256[:40] and stores the MP3 bytes in private Vercel Blo…` |
| 397 | → | `… (only when the parent didn't type one) → **style-consistent art** (the child's house style-guide im…` |
| 407 | → | `- **Native, single tile** (iOS → **Add a tile**): system camera or Photos → the pre-gen review sheet…` |
| 408 | → | `- **Native, bulk import** (iOS → **Choose photo(s)**): multi-select up to 50; each photo becomes a d…` |
| 414 | ✨▶ | `… a whole batch finishes rendering, a **"✨ N new tiles ready — Review"** banner pops on the board (ev…` |
| 504 | → | `/u/:slug         → app.html             (the child's board)` |
| 505 | → | `/parent/:slug    → parent.html` |
| 506 | → | `/therapist       → therapist-home.html  (roster of children the therapist sees)` |
| 507 | → | `/therapist/:slug → therapist.html` |
| 508 | → | `/login           → login.html` |
| 509 | → | `/reset           → reset.html` |
| 510 | → | `/welcome         → welcome.html` |
| 511 | → | `/onboard/:slug   → onboard.html` |
| 512 | → | `/onboard         → onboard.html` |
| 536 | → | `… via the toolbar filter + **Bulk action → Mark (non-)core**. \|` |
| 572 | → | `…ope-based defaults (e.g. `category=Food → gpt-image-1.5`). The generator falls back to these when no…` |
| 581 | ✓⚠⬆✨ | `…tegories` rows. Each row shows status — ✓ chip+image / ⚠ chip, no image / — not on board yet / ⚠ nee…` |
| 590 | ★ | `…idate per active style guide so you can ★ the winner.` |
| 591 | ⬆ | `- **⬆ Upload image** — attach an image you made elsewhere as a candidate (no OpenAI cost).` |
| 592 | 🚀★ | `- **🚀 Push live** — copies the ★ best candidate to the chosen child's board (`POST /api/admin/lab-pu…` |
| 593 | ⬇ | `- **⬇ Port from board** — pull the child's existing board image back into the strip as a candidate.` |
| 594 | 🎭 | `- **🎭 Scene / people** — the variable subject composer (see below).` |
| 596 | 🚀 | `The 🚀 **Board:** field in the header is the publish target for the whole page; switching it refreshe…` |
| 605 | → | `…hly uploaded photo \| `POST /api/upload` → `blobKey` \|` |
| 615 | 🚀 | `1. Pick the **🚀 Board:** target in the header.` |
| 618 | ★🚀 | `…n the tile walker, generate candidates, ★ the best, **🚀 Push live**.` |
| 619 | 🎭 | `… tiles that need real people, use the **🎭 Scene / people** composer instead of plain Generate.` |
| 633 | → | `…ueue: POST raw photo (safe immediately) → server renders + places the tile; GET polls status; DELETE…` |
| 640 | → | `…boarding state machine: progress cursor → child (name/voice/style) → repeatable family **keystone po…` |
| 672 | → | `…m an invite code at the `/welcome` gate → signed `mw_invite` cookie (carries the code so signup can …` |
| 678 | ★🚩 | `… a candidate), `publish-tile` (copy the ★ best to a child's board), `settings` (GET/PUT master promp…` |
| 689 | → | `## Env vars (Vercel → Settings → Environment Variables)` |
| 722 | → | `…00) — confirm they appear under Project → Settings → Cron Jobs after deploy.` |
| 730 | → | `- Push to the branch → Vercel deploys → the iPad shell picks up the change on next launch. No reinst…` |
| 742 | →▶ | `In Xcode: select the iPad → Signing & Capabilities → set Team → ▶ Run.` |
| 744 | → | `…th restricted child accounts): **Window → Devices and Simulators → select iPad → "Installed Apps" → …` |
| 773 | → | `_lib/age-band.js    Birth date → developmental band; higherBand resolver` |
| 798 | → | `MyWorld/ContentView.swift     Role gate → BoardView \| ParentHomeView \| RolePicker` |
| 838 | ↔ | `- **Parent ↔ therapist invite/request UI.** Schema and helpers exist; therapist-facing accept/declin…` |


### `docs/OWNERS-MANUAL.md` (67 lines)

| Line | Emoji | Context |
|---:|---|---|
| 10 | → | `(pre-merge gate → deploy → production smoke → TestFlight/Play + launch` |
| 28 | → | `\| Kid board (iPad) \| kid-ios/ (XcodeGen → Xcode) \| child \|` |
| 31 | → | `\| Onboarding \| onboard.html (signup → style → people → scene → board build) \| parent \|` |
| 45 | → | `(style defaults → generic defaults → word tiles). Migrations run inline in` |
| 82 | → | `…-authorized signups: `role_grants` (Lab → Reports → Accounts) applies` |
| 88 | → | `seeded via Lab → Translations, tester loop = CSV export → native review →` |
| 90 | → | `…*Access experiments** (parent dashboard → Access panel, admin-only):` |
| 92 | ▶✕ | `… `sentenceIdleMin`; staging is silent — ▶ speaks, ✕ clears),` |
| 93 | → | ``listenRepeatNav` (say a word twice → board jumps to the tile).` |
| 99 | → | `…S_KEYS gate), set from parent dashboard → Board tab (themed accordions)` |
| 100 | → | `→ Touch & safety; the kid apps pick them up on launch/refresh:` |
| 109 | ✕ | `- `easyClose` — game ✕ closes on a quick tap instead of the hold.` |
| 116 | → | `visibility per child (Board → Board tools; default ON).` |
| 140 | → | `…flagged for review); unblock in Reports → Spend guard. A paused` |
| 160 | → | `dashboard → Art style (`/api/parent/style`; uploads fork a child-scoped` |
| 166 | 📤→ | `…aults can bypass prompts: defaults view 📤 → `default-upload`` |
| 174 | ⬜ | `stays settable via Lab's ⬜ Square-tiles tool (TV/movie posters).` |
| 175 | → | `…rks by touch on every surface**: unlock → edit mode →` |
| 188 | ⚠ | `landed) appears as a ⚠️ alert in all three parent views — web dashboard` |
| 191 | ⭐ | `tiles ⭐5 — keystone pricing); restarting a failed photo add never` |
| 202 | ⭐ | `object, ⭐1 each). The question is DURABLE: every finished job stays` |
| 216 | → | `…pects opt-out; keepsakes in parent Home → Moments.` |
| 226 | → | `case → **Start review** (snapshots the board + sends the "we've opened` |
| 227 | → | `your board" notice — first click only) → edit their board via the case's` |
| 228 | → | `parent-dashboard/kid-board links → **Preview changes** anytime →` |
| 230 | → | `regenerating replaces draft edits) → edit the draft, add context →` |
| 238 | →✨ | `…ew style** (new show, new craze): admin → **✨ New Style` |
| 239 | → | `…e-wizard.html`). Upload one style image → generate/` |
| 241 | →🚀 | `your own) → 🚀 Generate — the whole default board (every tile + folder` |
| 243 | → | `with the tab closed → review the gallery + demo preview → **Publish**.` |
| 252 | → | `…e board** (per style, optional): wizard →` |
| 254 | ✨ | `look ("a girl with curly red hair"), ✨ Generate (or upload) their` |
| 255 | ✓🚀 | `reference, ✓ Save, then **🚀 Render their tiles** — only the person tiles` |
| 262 | → | `…verything a voice says**: Voice library →` |
| 263 | 🎧 | `**🎧 Listen & confirm** reviews every standard-library word AND every` |
| 265 | ▶ | `exact cached clips boards play. **▶▶ Hands-free** auto-approves each clip` |
| 267 | ←✓↻ | `(← Back withdraws the last ✓, ↻ re-renders and replays). Marks persist` |
| 269 | ✓ | `machine. **✓ Approve whole voice** marks everything in one click when you` |
| 274 | → | `… without it; enable it under ElevenLabs → API Keys), or the` |
| 279 | → | `… under `demo-audio/`. That's what admin →` |
| 280 | →🌍 | `**Voice library** → 🌍 Practice-board voices prepares — and because` |
| 282 | ⚡ | `"⚡ Copy + fill clips" pulls already-generated words from cache **free**` |
| 296 | → | `**Publish to boards → layout skips it automatically** from then on (the` |
| 297 | ⚠ | `log says so per board). The amber "⚠️ Also overwrite family-arranged` |
| 303 | 🙋 | `"🙋 Ask families to approve instead" option. No board changes; each` |
| 310 | → | `…p artifact from BEFORE the push (GitHub → Actions →` |
| 325 | ⚙ | `⚙ Display, session-only) with an education bar that leads with` |
| 326 | 🎙 | `**🎙 Try listening**: the browser's own speech recognition captions what` |
| 342 | → | `**signup limit** (Admin → Invites → "Signup limit" on create, or the` |
| 348 | → | `…out their child — review it under Admin → Tools → Load` |
| 355 | →➕ | `- **Add-on boards**: Lab → Default board → ➕ New board with "Add-on" checked` |
| 361 | ⭐ | `"uses ⭐N — you have ⭐M" and waits for OK (see surface-audit F1b);` |
| 364 | 🎨 | `… same themed order, most-common first — 🎨 Board` |
| 365 | 🖼🔘✋🎙 | `look · 🖼 Art style · 🔘 Board tools · ✋ Touch & play · 🎙 Listening ·` |
| 366 | 🔒📱⚙ | `🔒 Safety & unlock · 📱 This device. Editors: the web board's ⚙ Display` |
| 367 | ⚙ | `…he dashboard accordions, and each app's ⚙ Display sheet +` |
| 376 | ⭐→ | `walked through favorite foods (⭐3 gift) → toys (⭐3 gift) → shows &` |
| 380 | ⭐ | `the honest "month one's ⭐ mostly build the board" note here and on the` |
| 385 | ⚙ | `writes — same defaults, same toggles as ⚙ Display settings, so skipping` |
| 387 | → | `style" → `/practice?style=<id>` (public shared art only). Show/movie art legal posture + the TMDB op…` |
| 413 | → | `… App Store / Play page once live; unset → text instructions).` |
| 416 | → | `All unset by default → gate off; clients FAIL OPEN on any error (an AAC` |
| 424 | → | `…ks/tester-family-onboarding.md — invite → role grant → language →` |
| 425 | → | `voices → verify.` |
| 428 | → | `…e.md — sync/images/TTS/credits failures → where to` |
| 432 | → | `- runbooks/stripe-go-live.md — test → live.` |
| 445 | → | `…o for /practice must be built once: Lab → `action=demo-audio`` |


### `docs/launch-audit.md` (22 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | ✅⚠ | `…xperience it, plus the operator's view. ✅ = exists and works · ⚠️ = exists with a gap` |
| 5 | ❌ | `· ❌ = missing. Legal drafts live in `docs/legal/`.` |
| 9 | ❌ | `…inding it.** welcome/index pages exist. ❌ No pricing shown anywhere before` |
| 10 | ❌ | `…image, $9.99/mo" until they're inside). ❌ No` |
| 15 | ✅ | `**Step 1 — Creating the account.** ✅ Self-signup and invite paths, password rules,` |
| 16 | ⚠ | `signed cookies. ⚠️ No email verification — a typo'd email silently orphans password` |
| 17 | ❌ | `resets and receipts. ❌ No consent checkbox (terms/privacy/COPPA parental consent/photo` |
| 20 | ✅ | `**Step 2 — Child details.** ✅ Name + birth date collected; used well (age-band` |
| 21 | ⚠ | `vocabulary). ⚠️ Nothing tells the parent *why* birth date is needed or that they can` |
| 24 | ✅❌ | `**Step 3 — Child photo.** ✅ Works; durable pipeline. ❌ No disclosure that the photo of` |
| 28 | ✅❌ | `**Step 4 — Parent/family photos.** ✅ Works (flaky-step retry fixed earlier). ❌ No` |
| 32 | ✅❌ | `**Step 5 — Style + voice.** ✅ Keystone flow, voice samples. ❌ No note that voices are` |
| 35 | ✅ | `**Step 6 — Board build.** ✅ Instant defaults + honest progress banners; interruption-` |
| 36 | ⚠ | `proof. ⚠️ No completion email ("your board is ready") — the one moment a transactional` |
| 39 | ✅ | `…Step 7 — Buying credits/subscription.** ✅ StoreKit + restore + coupons; packs now` |
| 40 | ❌ | `50–1000. ❌ Apple-required auto-renew disclosure text + in-app Terms/Privacy links` |
| 41 | ❌ | `… §6 — App Review 3.1.2 will flag this). ❌ No` |
| 42 | ⚠ | `receipts/purchase-history email; ⚠️ web Stripe checkout exists but has no refund policy` |
| 45 | ✅❌ | `**Step 8 — Daily use / leaving.** ✅ Listening mode, games, auto-teach, progress. ❌` |
| 46 | ✅ | `…first listening-mode use (drafted, §5). ✅ Web account deletion` |
| 47 | ❌ | `…ly complete (everything, hard confirm). ❌ **No in-app account deletion on` |
| 48 | ⚠ | `…it since accounts are created in-app.** ⚠️ No` |


### `docs/HANDOFF.md` (19 lines)

| Line | Emoji | Context |
|---:|---|---|
| 35 | → | `- **PR #141** (branch → main) is OPEN with ~35 commits: landing refresh +` |
| 40 | ⭐ | `…isions, enforced in code)**: Plus $9.99/⭐50, Pro` |
| 41 | ⭐ | `$19.99/⭐150; Starter hidden (`hidden: true`, sku valid for comps); no` |
| 49 | → | `paragraph (Admin → Tools → Load waitlist).` |
| 77 | → | `1. **Merge PR #141** → Vercel deploys → images/waitlist/pricing live.` |
| 79 | →⭐ | `(4242… → ⭐50 lands → pack unlocks → portal cancel).` |
| 81 | → | `4. Xcode: bump build, archive, upload → TestFlight on the family iPads.` |
| 95 | ⚙ | `- Web + Android boards still say "⚙ Display" (iOS renamed to Settings with` |
| 121 | → | `…tore_only is flippable per board in Lab → Boards). Status:` |
| 123 | ✅ | `- ✅ **CSV corrected + committed**: `data/taxonomy-additions-2026-07.csv`` |
| 125 | → | `People→Nouns; "PB and J" left for owner review). Source batches: 191 food,` |
| 128 | ✅ | `- ✅ **Dedup-aware importer**: `POST /api/admin/taxonomy?fn=import-csv`` |
| 132 | 📥 | `"📥 Merge batch…" in admin/taxonomy.html (reuses parseCSVText).` |
| 133 | ⬜ | `- ⬜ **After merge (owner, in Lab)**: create store-only boards covering the` |
| 137 | ⬜ | `- ⬜ **#10 suggestion queue** (the hero): word_suggestions table, canonical` |
| 140 | ⬜ | `- ⬜ **#12** repeat-nav threshold Off/2/3 = graduate listenRepeatNav from the` |
| 143 | ⬜ | `- ⬜ **#11** movie flow (Wikidata find, IMDb link, parent-obtains poster),` |
| 155 | ✅ | `- ✅ #12 shipped (web): listenRepeatNav graduated out of ACCESS_KEYS (E6` |
| 159 | 🟡 | `- 🟡 #13 partially: sentence constructor + both modes DOCUMENTED in README` |


### `therapist-library.html` (15 lines)

| Line | Emoji | Context |
|---:|---|---|
| 61 | 🧩 | `<h1>My boards 🧩</h1>` |
| 96 | 📤 | `<button class="btn ghost" id="ed-share">📤 Share with…</button>` |
| 111 | ✨ | `…or:var(--pink-deep);margin-bottom:4px;">✨ Make from a photo</div>` |
| 114 | 📷 | `…utton id="ti-magic" style="width:100%;">📷 Choose photo & make it</button>` |
| 185 | 🧩 | `: `<div class="thumb">🧩</div>`}` |
| 234 | 🧩 | `: `<div class="thumb">🧩</div>`}` |
| 235 | 🔊 | `…div><div class="extra">${it.soundKey ? '🔊 has audio' : 'no audio yet'}</div></div>` |
| 293 | 🎨 | `$('ti-magic-status').textContent = '🎨 Creating the artwork…';` |
| 299 | 🔊 | `$('ti-magic-status').textContent = '🔊 Making the voice…';` |
| 301 | ✓ | `…-status').textContent = 'AI voice ready ✓'; }` |
| 302 | ✅ | `$('ti-magic-status').textContent = '✅ Ready — tap Save tile.';` |
| 308 | ✓ | `…-status').textContent = 'Image selected ✓';` |
| 319 | ✓ | `…und-status').textContent = 'Voice ready ✓';` |
| 323 | ✓ | `…-status').textContent = 'Sound selected ✓'; } });` |
| 363 | 🧒 | `…ont-size:16px;color:#d6a8c6;flex:none;">🧒</span>`}` |


### `kid-ios/README.md` (15 lines)

| Line | Emoji | Context |
|---:|---|---|
| 13 | → | `parent → child: gear → "Use as the child's board".` |
| 14 | → | `child → parent: triple-tap the header → Settings → "Switch this device to the` |
| 27 | → | `…RD §4.7) \| `POST /api/message-to-board` → token preview strip \|` |
| 62 | → | `… **MyWorld** target in the left sidebar → **Signing & Capabilities**.` |
| 65 | →▶ | `3. Plug in your iPad → select it in the target dropdown at the top → ▶ Run.` |
| 75 | → | `…red. **Don't add files via Xcode's File → New**` |
| 130 | → | `Long-press the lock → edit mode → **Add a tile** (single) or **Choose photo(s)**` |
| 132 | → | `…stant it returns), and the server names →` |
| 133 | → | `generates style-consistent art → voices → places the tile, with a one-minute` |
| 138 | → | `info" sheet: override the name (blank → AI names it) and add an optional detail` |
| 144 | → | `— rename, swap picture (new photo → art or use as-is), keep-aspect, re-voice,` |
| 147 | ▶ | `…s, a banner opens a review sheet (art + ▶ voice + editable` |
| 150 | → | `…iles as posters (rectangular). Settings → "Make all tiles square"` |
| 157 | → | `…orage/ImageDownscale.swift Shared photo → ≤1024px JPEG helper` |
| 172 | ▶ | `▶ Run in Xcode with the iPad as target. The app installs over USB. Each save +` |


### `docs/android.md` (14 lines)

| Line | Emoji | Context |
|---:|---|---|
| 21 | → | `\| Edit mode: tap-to-edit sheet (rename→re-voice, pin, move, guided redraw, delete), add-tile flow (p…` |
| 23 | → | `\| Onboarding: demo → account (consent) → child (style + voice pickers) → photos (free retries, repea…` |
| 24 | → | `…ished purchases re-post on launch; Fire → web-store handoff \| `billing/BillingClientManager.kt` \|` |
| 31 | ✅ | `… board, all personalized tiles/voices \| ✅ \| ✅ \| ✅ \|` |
| 32 | ✅ | `…pp (stats, shop, auto-teach, people…) \| ✅ \| ✅ \| ✅ (web dashboard) \|` |
| 33 | ✅ | `…s, Teach Me, facilitator live channel \| ✅ \| ✅ \| ✅ \|` |
| 34 | ✅❌ | `\| Speech-to-text listening mode \| ✅ on-device \| ❌ no speech service on Fire OS \| ✅ (Chrome) \|` |
| 35 | ✅ | `\| Camera / photo-library tile adds \| ✅ \| ✅ (camera if present) \| ✅ \|` |
| 36 | ✅ | `\| Memberships & credit purchases \| ✅ Google Play (native) \| web store (Stripe) handoff \| ✅ Stripe \|` |
| 37 | ❌ | `\| Push notifications \| ❌ v1 (board is a foreground device) \| ❌ \| ❌ \|` |
| 48 | → | `3. Release: `Build → Generate Signed App Bundle / APK…` — create the keystore` |
| 73 | → | `1. Fresh install → onboarding → seeded board → 10 tiles speak.` |
| 82 | → | `the group, duplicate re-post → `duplicate:true`, PENDING purchase, kill the` |
| 83 | → | `app between purchase and verify → relaunch grants exactly once.` |


### `docs/runbooks/incident-triage.md` (14 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `1. reports → sync health: is the device pinging? If the device pings but` |
| 9 | → | `content is stale, it's client cache → board Reload-from-server (edit` |
| 13 | → | `issue → confirm `api/init.js` ran (hit any endpoint) and the failing` |
| 15 | → | `…oard for a NEW family = seeding stalled → next section.` |
| 19 | → | `…ding banner stuck at N of M for >30 min → seed jobs dead.` |
| 23 | → | `cron isn't firing at all: Vercel → Settings → Cron Jobs (and CRON_SECRET` |
| 41 | → | `1. One tile vs everything? One tile → its sound_key missing; re-voice from` |
| 42 | → | `the tile editor or push sounds (Lab → Publish).` |
| 43 | → | `2. Everything, runtime TTS also silent → ElevenLabs: env key` |
| 45 | → | `3. Wrong VOICE → child_settings.voiceId; check the voice still exists and` |
| 47 | → | `4. Wrong LANGUAGE audio → the tile clips predate a language change: push` |
| 52 | → | `1. reports → purchases vs fulfillment: rows marked FAILED/STUCK.` |
| 53 | → | `…tripe: webhook delivery log (Developers → Webhooks) — 4xx/5xx from our` |
| 69 | → | `Resend dashboard → domain must be VERIFIED (DNS records at the registrar,` |


### `docs/taxonomy-parity-report.md` (11 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `## Board category → official category` |
| 10 | ✓ | `…ning (117), Body (18) \| already matches ✓ \|` |
| 12 | ✓ | `…\| Food (20), Home (7) \| already matches ✓ \|` |
| 14 | ✓ | `…me (32), Holidays (8) \| already matches ✓ \|` |
| 16 | ✓ | `…School (13), Toys (2) \| already matches ✓ \|` |
| 17 | ✓ | `…hes (12), Animals (3) \| already matches ✓ \|` |
| 21 | → | `…Does Things \| 13 \| Actions (8) \| rename → **Actions** \|` |
| 22 | → | `… for Things \| 11 \| Actions (5) \| rename → **Actions** \|` |
| 54 | → | `1. **Verbs → "Actions".** Your *Fletcher Asks for Things* + *Fletcher Does Things* are both the offi…` |
| 55 | → | `2. **"Living Things" → split into Animals + Nature.** Rename **Living Things → Animals**, and move i…` |
| 56 | → | `…l category. Move *Learning / Body parts → Body*. (Your *Learning / Weather* officially lives under *…` |


### `login.html` (9 lines)

| Line | Emoji | Context |
|---:|---|---|
| 62 | 👋 | `…ink-deep);margin-bottom:4px;">You're in 👋</div>` |
| 76 | 📸→ | `<a class="cta" href="/signup">📸 Create your child's account →</a>` |
| 77 | ← | `…e="color:var(--muted);font-weight:600;">← See how My World works</a></p>` |
| 132 | 🏫🧑⚕ | `… label = user.role === 'school_team' ? '🏫 My children' : '🧑‍⚕️ My children';` |
| 137 | 👪 | `out.push(['👪 ' + slug + ' — parent dashboard', '/parent/' + encodeURIComponent(slug)]);` |
| 138 | 🧒 | `out.push(["🧒 " + slug + " — child board", '/u/' + encodeURIComponent(slug)]);` |
| 140 | 📸 | `out.push(['📸 Set up a new child (onboard)', '/onboard']);` |
| 143 | 🧬 | `out.push(['🧬 Taxonomy (admin)', '/admin/taxonomy.html']);` |
| 145 | 🧒 | `if (!out.length) out.push(['🧒 Go to the board', '/u/' + encodeURIComponent(slug)]);` |


### `docs/runbooks/tester-family-onboarding.md` (9 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `…m the signup link (myworldtaptotalk.com → Get early access, or an` |
| 13 | → | `…. Watch their build: admin/reports.html → sync health; or Lab board-state.` |
| 14 | → | `4. If images stall: Lab → the seed-rescue tool re-arms dead jobs.` |
| 20 | → | `1. BEFORE they sign up: Lab → Reports → Accounts panel → role grant for` |
| 27 | → | `…ice for the language: admin/voices.html → add voice by` |
| 33 | → | `6. Review loop: Lab → Translations → CSV export → they correct → import` |
| 35 | → | `… enable language AFTER tiles exist: Lab → Publish → push sounds to` |
| 41 | → | `…/parent/<their-child-slug>` — Board tab → Access` |
| 54 | → | `- Tap a tile → hears the chosen voice.` |


### `docs/listening-mode.md` (7 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | 🎙 | `from the board's own **🎙️ mic button** (child-accessible, not behind edit mode) or` |
| 22 | 🎙 | `… **`Views/HeaderBar.swift`** — adds the 🎙️ mic button (left, opposite Play; red` |
| 46 | →▶ | `In Xcode: pick the iPad → set your Team under Signing & Capabilities → ▶ Run (or` |
| 47 | → | `Archive → TestFlight, as usual).` |
| 51 | → | `…pack downloaded on the device (Settings →` |
| 52 | → | `General → Keyboard / Dictation). If a device lacks on-device support, Apple falls` |
| 57 | 🎙 | `Unlock isn't required. Tap the **🎙️** button in the header (it turns red / becomes a` |


### `docs/people-data-model.md` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 70 | → | `- `pronoun` = grammatical (she/he/they) → "add **her** photo", "call **her**".` |
| 71 | → | `…ronunciation` = phonetic ("say it as…") → already captured today; keep it.` |
| 77 | → | `… child_id=$1 AND relationship='mother'` → `given_name`, `pronoun`, `reference_key` \|` |
| 78 | → | `…neration \| pass `relationship` + `side` → deterministic "grandma on your mom's side" \|` |
| 94 | → | `from label/category ("Mama"→mother, "Dada"→father, "Papa X"→grandfather,` |
| 95 | → | `"Grandma/Nana X"→grandmother, siblings→brother/sister) and **flag inferred rows for` |


### `docs/native-parity-backlog.md` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 9 | ⭐ | `…-drop reorder + move across categories  ⭐ (explicit ask)` |
| 14 | → | `- Build: unlock (edit mode) → long-press-drag tiles in `SectionColumn`; drop on` |
| 21 | → | `…ge()` guards out when `imageKey` is nil → blank` |
| 44 | ⭐ | `### B1. Listening-mode remote button  ⭐ (part of the original listening ask)` |
| 72 | ⚠ | `…B5. Out-of-credits (HTTP 402) handling  ⚠️ ships broken TODAY without this` |
| 78 | → | `- Build: catch 402 → friendly "You're out of image credits" alert with a` |


### `taxonomy/README.md` (6 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `skeleton (same slugs, same category → subcategory structure), and only the` |
| 25 | → | `… via the toolbar filter + **Bulk action → Mark non-core**. \|` |
| 34 | → | `…er (§11.10) — ordered concrete-personal → abstract-conventional renderings. JSONB; per-child operati…` |
| 83 | → | `…nd multi-child scenes (foreground child → `{reference}`, the` |
| 94 | → | `2. **Import…** → upload `seed-core-v1.csv` (or paste it). Leave new rows as `draft`.` |
| 109 | → | `…*Scene tags** for the "snap your pantry → auto-fill" flow. Today the target` |


### `therapist-home.html` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 48 | 🧩 | `<a href="/therapist/library">🧩 My boards</a>` |
| 53 | 🧑⚕ | `<h1>Your children 🧑‍⚕️</h1>` |
| 57 | 📨 | `<h2>📨 You have an invitation</h2>` |
| 70 | 🧒 | `: `<div class="pic">🧒</div>`;` |
| 87 | 🧒 | `: `<div class="pic">🧒</div>`}` |


### `docs/add-image-audit.md` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 5 | → | `\| # \| Surface \| Endpoint → renderer \| Prompt source \|` |
| 7 | → | `…b** (fantastic) \| `lab?action=generate` → `_lab-generate.js` \| Hand-curated per-word `prompt_templat…` |
| 8 | → | `… store / retries** (good) \| `seed_jobs` → `renderTaxonomyTile` \| Same as the Lab: master prompt + te…` |
| 9 | → | `…board adds** (lackluster) \| `tile_jobs` → `renderStyledPhoto` \| ONE hardcoded sentence: *"Re-illustr…` |
| 38 | → | `## The alignment plan — "describe → compose → render"` |


### `docs/runbooks/domain-flip.md` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 1 | → | `# Domain flip: aac.andrewpeterson.io → myworldtaptotalk.com` |
| 10 | → | `1. Vercel → Project → Settings → Domains → Add: the apex` |
| 14 | → | `apex `A → 76.76.21.21`, www `CNAME → cname.vercel-dns.com`.` |
| 18 | ✓ | `4. Wait for the ✓ (DNS + auto-TLS, usually minutes) and load /practice,` |
| 52 | → | `- Stripe webhook endpoint URL → new domain (add a second endpoint first,` |


### `docs/runbooks/release.md` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 12 | → | `Env vars live in Vercel → Project → Settings → Environment Variables — the` |
| 14 | → | `Rollback: Vercel dashboard → Deployments → promote a previous one.` |
| 27 | → | `Bump project.yml → xcodegen generate → Product → Archive → in Organizer,` |
| 31 | → | `- TestFlight tab → build appears after processing (10–30 min).` |
| 42 | → | `in Android Studio → build. Release: Play Console (billing uses` |


### `docs/runbooks/stripe-go-live.md` (5 lines)

| Line | Emoji | Context |
|---:|---|---|
| 1 | → | `# Stripe: test → live` |
| 9 | → | `1. Stripe dashboard → toggle out of test mode. Recreate the SAME products/` |
| 16 | → | `3. Live keys → Vercel PRODUCTION env only:` |
| 18 | → | `- Webhook: Developers → Webhooks → add endpoint` |
| 23 | → | `…_canceled_at`). Copy the signing secret →` |


### `docs/runbooks/backup-restore.md` (4 lines)

| Line | Emoji | Context |
|---:|---|---|
| 17 | → | `pooler). GitHub → repo → Settings → Secrets and variables → Actions.` |
| 19 | → | `To grab a backup: repo → Actions → "Nightly DB backup" → newest run →` |
| 20 | → | `Artifacts. To force one now: same page → Run workflow.` |
| 34 | → | `- **Lab → `/api/admin/lab?action=backup&op=inventory`** (admin) reconciles` |


### `schedule-editor.js` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 92 | ✓ | `setStatus('Saved ✓');` |
| 104 | ✕ | `…abel="Remove" style="margin-left:auto;">✕</button></div>';` |
| 120 | ✕ | `…nackdel="' + i + '" aria-label="Remove">✕</button></div></div>'; });` |


### `docs/legal/disclosure-placements.md` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 13 | ☐ | `> ☐ I'm the parent or legal guardian (or a caregiver with their permission), I'm 18+,` |
| 60 | → | `> cancel in Settings → Apple ID → Subscriptions. Credits are non-refundable once spent` |
| 80 | → | `…ete account…" row to ParentSettingsView → Account section that calls` |


### `taxonomy/content/function-words.md` (3 lines)

| Line | Emoji | Context |
|---:|---|---|
| 7 | → | `… and one outright wrong script ("never" → "I always keep trying").` |
| 10 | → | `…t.** Meaning through a concrete routine → two everyday` |
| 11 | → | `examples → a phrase the child can actually deploy. No grammar words (sentence,` |


### `middleware.js` (2 lines)

| Line | Emoji | Context |
|---:|---|---|
| 13 | → | `…ill require a valid `mw_session` cookie →` |
| 29 | → | `// funnel flows landing → practice → signup without a wall; the invite code is` |


### `charts.js` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 85 | ⭐ | `…tarred.map(s => `<span class="ins-star">⭐ ${esc(prettySkill(s.name))}</span>`).join('')` |


### `accept-invite.html` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 48 | 🧒 | `<div class="pic" id="child-pic">🧒</div>` |


### `.github/workflows/backup.yml` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 8 | → | `# pooler). Settings → Secrets and variables → Actions → New repository secret.` |


### `android/app/src/main/java/io/andrewpeterson/myworld/MainActivity.kt` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 237 | → | `// Android's Screen Pinning — Settings → Security — as the true` |


### `cap-shell/index.html` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 21 | 🌍 | `<h1>🌍 My World</h1>` |


### `tools/surface-audit/practice_smoke.cjs` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 133 | ⚙ | `// ── ⚙ Display modal: session-only look controls (sessionStorage, no API) ──` |


### `tools/surface-audit/stub_server.py` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 273 | → | `{'kind': 'combo', 'key': 'combo:eat→banana', 'payload': {'phrase': 'eat banana'}, 'at': '2026-07-11T…` |


### `docs/legal/privacy-policy.md` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 90 | → | `\| OpenAI \| AI image generation (photos → illustrated tiles) \|` |


### `taxonomy/seed-core-v1.csv` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 658 | ✨ | `…hat and a soft starburst with the words ✨ at the top (no letters), a single clear subject centered a…` |


### `taxonomy/board-gap-to-create.csv` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 265 | ✨ | `…hat and a soft starburst with the words ✨ at the top (no letters), a single clear subject centered a…` |


### `taxonomy/content/adjectives.md` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `…e adjective voice: **meaning(+opposite) → examples → a phrase he can say.**` |


### `taxonomy/content/feelings-body-states.md` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `Descriptions use: **what it means → the body signal (how you know) → when you feel it + what you can…` |


### `taxonomy/content/community-helpers.md` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 4 | → | `…scriptions: **who they are/what they do → what they wear/use → where you see them.**` |


### `taxonomy/content/verbs.md` (1 lines)

| Line | Emoji | Context |
|---:|---|---|
| 3 | → | `… use three lenses: **what it means/does → how your body does it → when/where you'd use it** (with a …` |


---

Total: 1955 emoji-bearing lines. No emoji were removed or altered by this audit.
