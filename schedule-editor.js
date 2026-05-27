// Shared "daily schedule" editor used by both the parent and therapist views.
// Captures the child's routine (wake / breakfast / lunch / dinner), up to six
// snack times, and where they are through the week (location + days + time
// range). Stored under child-settings as `settings.schedule`. Triggering off
// this data comes later — for now we just capture it.
//
// Usage:
//   ScheduleEditor.mount({ container, slug,
//                          getSettings, onSave })   // parent: share its object
//   ScheduleEditor.mount({ container, slug })       // therapist: self-managed
(function () {
  'use strict';
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const LOC_TYPES = [
    ['home', 'Home'], ['school', 'School'], ['therapy', 'Therapy'],
    ['daycare', 'Daycare'], ['friend', "Friend's house"], ['relative', "Relative's house"], ['other', 'Other'],
  ];
  const MAX_SNACKS = 6;
  let styled = false;

  function injectStyles() {
    if (styled) return; styled = true;
    const css = `
    .se-wrap { font: inherit; }
    .se-grp { margin: 0 0 20px; }
    .se-grp h4 { margin: 0 0 8px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #9d174d; }
    .se-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .se-row > label { font-size: 13px; font-weight: 600; color: #374151; min-width: 64px; }
    .se-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .se-field { display: flex; flex-direction: column; gap: 4px; }
    .se-field > span { font-size: 12px; font-weight: 600; color: #6b7280; }
    .se-in { padding: 9px 10px; border: 1px solid #f3c6da; border-radius: 10px; font: inherit; background: #fff; box-sizing: border-box; }
    .se-btn { border: none; border-radius: 999px; padding: 9px 15px; font: inherit; font-weight: 600; cursor: pointer; background: #fce4ec; color: #9d174d; }
    .se-btn:hover { background: #f9cfe0; }
    .se-btn.primary { background: #ec4899; color: #fff; }
    .se-btn.primary:hover { background: #db2777; }
    .se-del { border: none; background: transparent; color: #9ca3af; font-size: 16px; cursor: pointer; padding: 4px 8px; line-height: 1; }
    .se-del:hover { color: #db2777; }
    .se-loc { border: 1px solid #f3c6da; border-radius: 12px; padding: 12px; margin-bottom: 10px; background: #fff7fb; }
    .se-days { display: flex; flex-wrap: wrap; gap: 6px; }
    .se-day { width: 40px; height: 36px; border: 1px solid #f3c6da; border-radius: 9px; background: #fff; font-size: 13px; font-weight: 700; color: #6b7280; cursor: pointer; }
    .se-day.on { background: #ec4899; color: #fff; border-color: #ec4899; }
    .se-status { font-size: 13px; color: #6b7280; margin-left: 4px; display: inline-block; min-height: 18px; }
    .se-hint { font-size: 12.5px; color: #6b7280; line-height: 1.45; margin: 0 0 14px; }
    `;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function blank() { return { wake: '', breakfast: '', lunch: '', dinner: '', snacks: [], locations: [] }; }
  function normLoc(l) { l = l || {}; return { type: l.type || 'home', label: typeof l.label === 'string' ? l.label : '', days: Array.isArray(l.days) ? l.days.slice() : [], start: l.start || '', end: l.end || '' }; }

  function mount(opts) {
    const root = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
    if (!root) return { refresh() {} };
    injectStyles();
    const slug = opts.slug;
    const shared = typeof opts.getSettings === 'function';
    let ownSettings = {};
    let sched = blank();
    let saveTimer = null;

    const statusEl = document.createElement('span');
    statusEl.className = 'se-status';
    root.insertAdjacentElement('afterend', statusEl);

    function settingsObj() { return shared ? (opts.getSettings() || {}) : ownSettings; }
    function readSched() {
      const s = settingsObj().schedule || {};
      sched = Object.assign(blank(), s);
      sched.snacks = Array.isArray(sched.snacks) ? sched.snacks.slice(0, MAX_SNACKS) : [];
      sched.locations = Array.isArray(sched.locations) ? sched.locations.map(normLoc) : [];
    }
    async function loadOwn() {
      try {
        const r = await fetch('/api/child-settings?childId=' + encodeURIComponent(slug), { credentials: 'same-origin' });
        if (r.ok) { const d = await r.json(); ownSettings = (d && d.settings && typeof d.settings === 'object') ? d.settings : {}; }
      } catch (_) {}
    }
    function setStatus(t) { statusEl.textContent = t; }
    async function persist() {
      settingsObj().schedule = sched;
      setStatus('Saving…');
      try {
        if (shared && typeof opts.onSave === 'function') { await opts.onSave(); }
        else {
          const r = await fetch('/api/child-settings?childId=' + encodeURIComponent(slug), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ settings: ownSettings }),
          });
          if (!r.ok) throw new Error('save');
        }
        setStatus('Saved ✓');
      } catch (_) { setStatus('Not saved — try again'); }
      setTimeout(() => { if (/Saved/.test(statusEl.textContent)) setStatus(''); }, 2500);
    }
    function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500); }

    function locHtml(loc, i) {
      let h = '<div class="se-loc" data-loci="' + i + '">';
      h += '<div class="se-row"><label>Place</label><select class="se-in" data-loctype="' + i + '">';
      LOC_TYPES.forEach(([v, lab]) => { h += '<option value="' + v + '"' + (loc.type === v ? ' selected' : '') + '>' + esc(lab) + '</option>'; });
      h += '</select>';
      h += '<input class="se-in" type="text" maxlength="40" data-locname="' + i + '" placeholder="Name (optional)" value="' + esc(loc.label || '') + '" style="flex:1;min-width:120px;' + (loc.type === 'other' ? '' : 'display:none;') + '">';
      h += '<button class="se-del" data-locdel="' + i + '" aria-label="Remove" style="margin-left:auto;">✕</button></div>';
      h += '<div class="se-row"><label>Days</label><div class="se-days">';
      DOW.forEach((d, di) => { h += '<button type="button" class="se-day' + (loc.days.indexOf(di) >= 0 ? ' on' : '') + '" data-locday="' + i + '" data-day="' + di + '">' + d + '</button>'; });
      h += '</div></div>';
      h += '<div class="se-row"><label>Time</label><input type="time" class="se-in" data-locstart="' + i + '" value="' + esc(loc.start || '') + '"><span style="color:#9ca3af;">to</span><input type="time" class="se-in" data-locend="' + i + '" value="' + esc(loc.end || '') + '"></div>';
      h += '</div>';
      return h;
    }
    function render() {
      const meals = [['wake', 'Wake up'], ['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
      let html = '<div class="se-wrap">';
      html += '<p class="se-hint">Capture the daily rhythm and where the child is through the week. The speech therapist can help fill this in. (We\'ll use it later to surface the right board at the right time.)</p>';
      html += '<div class="se-grp"><h4>Daily routine</h4><div class="se-grid">';
      meals.forEach(([k, lab]) => { html += '<div class="se-field"><span>' + lab + '</span><input type="time" class="se-in" data-meal="' + k + '" value="' + esc(sched[k] || '') + '"></div>'; });
      html += '</div></div>';
      html += '<div class="se-grp"><h4>Snacks (up to ' + MAX_SNACKS + ')</h4><div class="se-grid">';
      sched.snacks.forEach((t, i) => { html += '<div class="se-field"><span>Snack ' + (i + 1) + '</span><div style="display:flex;gap:6px;align-items:center;"><input type="time" class="se-in" data-snack="' + i + '" value="' + esc(t || '') + '" style="flex:1;"><button class="se-del" data-snackdel="' + i + '" aria-label="Remove">✕</button></div></div>'; });
      html += '</div>';
      if (sched.snacks.length < MAX_SNACKS) html += '<button class="se-btn" id="se-snack-add" style="margin-top:10px;">＋ Add a snack</button>';
      html += '</div>';
      html += '<div class="se-grp"><h4>Where &amp; when</h4><div id="se-locs">';
      sched.locations.forEach((loc, i) => { html += locHtml(loc, i); });
      if (!sched.locations.length) html += '<p class="se-hint" style="margin:0 0 10px;">No locations yet — add home, school, therapy, etc.</p>';
      html += '</div><button class="se-btn primary" id="se-loc-add">＋ Add a location</button></div>';
      html += '</div>';
      root.innerHTML = html;
      bind();
    }
    function bind() {
      root.querySelectorAll('[data-meal]').forEach(el => el.addEventListener('change', () => { sched[el.dataset.meal] = el.value; queueSave(); }));
      root.querySelectorAll('[data-snack]').forEach(el => el.addEventListener('change', () => { sched.snacks[+el.dataset.snack] = el.value; queueSave(); }));
      root.querySelectorAll('[data-snackdel]').forEach(el => el.addEventListener('click', () => { sched.snacks.splice(+el.dataset.snackdel, 1); render(); persist(); }));
      const sa = root.querySelector('#se-snack-add'); if (sa) sa.addEventListener('click', () => { if (sched.snacks.length < MAX_SNACKS) { sched.snacks.push(''); render(); } });
      const la = root.querySelector('#se-loc-add'); if (la) la.addEventListener('click', () => { sched.locations.push(normLoc({})); render(); });
      root.querySelectorAll('[data-locdel]').forEach(el => el.addEventListener('click', () => { sched.locations.splice(+el.dataset.locdel, 1); render(); persist(); }));
      root.querySelectorAll('[data-loctype]').forEach(el => el.addEventListener('change', () => { sched.locations[+el.dataset.loctype].type = el.value; render(); queueSave(); }));
      root.querySelectorAll('[data-locname]').forEach(el => el.addEventListener('change', () => { sched.locations[+el.dataset.locname].label = el.value; queueSave(); }));
      root.querySelectorAll('[data-locstart]').forEach(el => el.addEventListener('change', () => { sched.locations[+el.dataset.locstart].start = el.value; queueSave(); }));
      root.querySelectorAll('[data-locend]').forEach(el => el.addEventListener('change', () => { sched.locations[+el.dataset.locend].end = el.value; queueSave(); }));
      root.querySelectorAll('[data-locday]').forEach(el => el.addEventListener('click', () => {
        const i = +el.dataset.locday, d = +el.dataset.day, days = sched.locations[i].days, k = days.indexOf(d);
        if (k >= 0) days.splice(k, 1); else days.push(d);
        el.classList.toggle('on'); queueSave();
      }));
    }

    async function refresh() { if (!shared) await loadOwn(); readSched(); render(); }
    if (shared) { readSched(); render(); } else { refresh(); }
    return { refresh };
  }

  window.ScheduleEditor = { mount };
})();
