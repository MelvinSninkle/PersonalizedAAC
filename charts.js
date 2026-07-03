// Shared progress-insights charts for the parent + therapist dashboards.
// (Extracted from byte-identical copies that lived in parent.html / therapist.html.)
//
// Series start EMPTY and render an honest empty state until /api/analytics fills
// real numbers — no fabricated "sample" data ships to either dashboard anymore.
// Each page keeps its OWN applyAnalytics (it wires page-specific bits like the
// recent-sessions table and the stat cards); this module owns the SERIES config,
// the color tables, and the actual drawing. The page exposes the child's name
// via Insights.init({ childName }).
window.Insights = (function () {
  const WEEKS = ['6w', '5w', '4w', '3w', '2w', '1w', 'now'];
  const SERIES = {
    games: {
      sub: 'First-try matching accuracy by category — taps, verbal, and object responses count equally. Mastered categories (100%) drop to a gold star below.',
      max: 100, unit: '%', collapseStarred: true, labels: WEEKS,
      star: s => s.data[s.data.length - 1] >= 100, starLabel: 'Mastered · 100%', list: [],
    },
    use: {
      sub: 'How often {name} communicates with each category on their own (taps per period). A gold star means they reached for it every day this week.',
      max: 40, unit: '', collapseStarred: false, dynamicMax: true, labels: WEEKS,
      star: s => s.daily, starLabel: 'Used every day this week', list: [],
    },
    time: {
      sub: 'Minutes per week. Total use is all the time {name} spends in the app; passive learning is time in the Learn and Exposure slideshows.',
      max: 200, unit: ' min', collapseStarred: false, dynamicMax: true, labels: WEEKS,
      star: () => false, starLabel: '', list: [],
    },
  };
  let childName = 'your child';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Series named by taxonomy slug ("people.community.workers") read as raw
  // artifacts to a parent — render them as "People › Community › Workers".
  // Mirrors prettySkillName in the iOS app; plain names pass through untouched.
  const SKILL_WORDS = { expr: 'Expressive', more: 'More', extra: 'Extra' };
  const prettySkill = (name) => String(name == null ? '' : name).split('.').map(seg =>
    SKILL_WORDS[seg] || (seg.charAt(0).toUpperCase() + seg.slice(1))).join(' › ');
  const $ = (id) => document.getElementById(id);
  function niceMax(v) {
    if (v <= 10) return Math.max(2, Math.ceil(v / 2) * 2);
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const s of [1, 2, 2.5, 5, 10]) { if (v <= s * mag) return s * mag; }
    return 10 * mag;
  }
  const COLORS = { 'People': '#f59e0b', 'Colors': '#ef4444', 'Body Parts': '#10b981', 'Animals': '#3b82f6', 'Foods': '#8b5cf6', 'Feelings': '#ec4899', 'Actions': '#06b6d4', 'Vehicles': '#14b8a6', 'Total use': '#0ea5e9', 'Passive learning': '#a855f7' };
  const PALETTE = ['#ff1493', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
  const colorFor = (name, i) => COLORS[name] || PALETTE[i % PALETTE.length];
  const W = 340, H = 200, PADL = 22, PADR = 10, PADT = 12, PADB = 22;

  function renderChart(key) {
    const cfg = SERIES[key];
    if (!cfg) return;
    if ($('ins-sub')) $('ins-sub').innerHTML = String(cfg.sub).replace(/\{name\}/g, esc(childName)).replace(/Fletcher/g, esc(childName));
    // Empty state — no fabricated numbers; the chart fills in once data exists.
    if (!cfg.list || !cfg.list.length) {
      if ($('ins-svg')) $('ins-svg').innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#9ca3af">No activity yet</text>`;
      if ($('ins-legend')) $('ins-legend').innerHTML = `<span style="font-size:12px;color:#9ca3af;">This fills in as ${esc(childName)} uses the board.</span>`;
      if ($('ins-stars')) $('ins-stars').innerHTML = '';
      return;
    }
    const labels = cfg.labels || WEEKS;
    const n = labels.length;
    let drawn = cfg.collapseStarred ? cfg.list.filter(s => !cfg.star(s)) : cfg.list.slice();
    if (drawn.length > 8) drawn = drawn.slice().sort((a, b) => b.data[n - 1] - a.data[n - 1]).slice(0, 8);
    const max = cfg.dynamicMax ? niceMax(Math.max(1, ...drawn.map(s => Math.max(...s.data)))) : cfg.max;
    const X = i => PADL + (i / (n - 1)) * (W - PADL - PADR);
    const Y = v => PADT + (1 - v / max) * (H - PADT - PADB);
    let svg = '';
    [0, max / 2, max].forEach(val => {
      const y = Y(val).toFixed(1);
      svg += `<line x1="${PADL}" y1="${y}" x2="${W - PADR}" y2="${y}" stroke="#f1e3ea"/>`;
      svg += `<text x="${PADL - 4}" y="${(+y + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#9ca3af">${Math.round(val)}</text>`;
    });
    drawn.forEach(s => {
      const pts = s.data.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      svg += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>`;
      svg += `<circle cx="${X(n - 1).toFixed(1)}" cy="${Y(s.data[n - 1]).toFixed(1)}" r="3" fill="${s.color}"/>`;
    });
    const step = n <= 8 ? 1 : Math.ceil(n / 7);
    labels.forEach((w, i) => { if (i % step === 0 || i === n - 1) svg += `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="8" fill="#9ca3af">${w}</text>`; });
    if ($('ins-svg')) $('ins-svg').innerHTML = svg;
    if ($('ins-legend')) $('ins-legend').innerHTML = drawn.map(s =>
      `<span class="lg"><i style="background:${s.color}"></i>${esc(prettySkill(s.name))} <b>${s.data[n - 1]}${cfg.unit}</b></span>`).join('');
    const starred = cfg.list.filter(cfg.star);
    if ($('ins-stars')) $('ins-stars').innerHTML = starred.length
      ? `<span class="lbl">${cfg.starLabel}</span>` + starred.map(s => `<span class="ins-star">⭐ ${esc(prettySkill(s.name))}</span>`).join('')
      : '';
  }

  function renderMastery(list) {
    const el = $('mastery');
    if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<p style="font-size:13px;color:#9ca3af;margin:6px 0;">No category accuracy yet — it appears after the first scored sessions.</p>';
      return;
    }
    el.innerHTML = list.map(([name, pct]) => `
    <div class="bar-row">
      <span>${esc(prettySkill(name))}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
      <span class="pct">${pct}%</span>
    </div>`).join('');
  }

  function init(opts) { if (opts && opts.childName) childName = opts.childName; }
  return { SERIES, WEEKS, niceMax, COLORS, PALETTE, colorFor, prettySkill, renderChart, renderMastery, init };
})();
