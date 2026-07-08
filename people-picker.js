// Shared family-relationship picker for the People model (docs/people-data-model.md).
// Plain DOM, no deps. Used by onboard.html (sign-up) and parent.html (manage family).
// Pulls the ordered options from GET /api/relationships (high-use first) and shows
// the maternal/paternal "side" only for grandparents/aunts/uncles/cousins, and the
// "birth order" field only for siblings (so multiples sort as Brother 1, 2, 3…).
(function () {
  let cache = null;
  async function getOptions() {
    if (cache) return cache;
    try {
      const r = await fetch('/api/relationships', { credentials: 'same-origin' });
      if (r.ok) { cache = await r.json(); return cache; }
    } catch (_) { /* fall through to the offline default */ }
    cache = {
      relationships: [
        { value: 'mother', label: 'Mother', age: 'adult' }, { value: 'father', label: 'Father', age: 'adult' },
        { value: 'sister', label: 'Sister', sibling: true, ageDefault: 'child' }, { value: 'brother', label: 'Brother', sibling: true, ageDefault: 'child' },
        { value: 'grandmother', label: 'Grandmother', side: true, age: 'adult' }, { value: 'grandfather', label: 'Grandfather', side: true, age: 'adult' },
        { value: 'aunt', label: 'Aunt', side: true, age: 'adult' }, { value: 'uncle', label: 'Uncle', side: true, age: 'adult' }, { value: 'cousin', label: 'Cousin', side: true, ageDefault: 'child' },
        { value: 'family_friend', label: 'Family friend', ageDefault: 'adult' }, { value: 'caregiver', label: 'Caregiver', age: 'adult' }, { value: 'pet', label: 'Pet' }, { value: 'other', label: 'Other', ageDefault: 'adult' },
      ],
      sides: ['maternal', 'paternal'], pronouns: ['she', 'he', 'they'],
    };
    return cache;
  }

  function optionsHtml(list, includeSelf) {
    return list.filter(r => includeSelf || !r.self).map(r => `<option value="${r.value}">${r.label}</option>`).join('');
  }

  // Build the full picker into `el`. Returns { getValues, setValues, reset }.
  async function mount(el, opts) {
    opts = opts || {};
    const o = await getOptions();
    const byVal = {}; o.relationships.forEach(r => (byVal[r.value] = r));
    const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:left;font-size:13px;color:#555;">
        <label style="grid-column:1/3;">Name on the tile
          <input type="text" class="pp-display" placeholder="e.g. Mama, Papa Gary" style="width:100%;margin-top:4px;padding:8px;border:1px solid #e6c9d6;border-radius:8px;font-size:14px;">
        </label>
        <label>Relationship
          <select class="pp-rel" style="width:100%;margin-top:4px;padding:8px;border:1px solid #e6c9d6;border-radius:8px;font-size:14px;">${optionsHtml(o.relationships, opts.includeSelf)}</select>
        </label>
        <label class="pp-side-wrap" style="display:none;">Side of family
          <select class="pp-side" style="width:100%;margin-top:4px;padding:8px;border:1px solid #e6c9d6;border-radius:8px;font-size:14px;"><option value="">—</option>${o.sides.map(s => `<option value="${s}">${cap(s)}</option>`).join('')}</select>
        </label>
        <label class="pp-birth-wrap" style="display:none;">Birth order <span style="color:#9ca3af;font-weight:400;">(1 = oldest)</span>
          <input type="number" min="1" step="1" class="pp-birth" placeholder="1" style="width:100%;margin-top:4px;padding:8px;border:1px solid #e6c9d6;border-radius:8px;font-size:14px;">
        </label>
        <label class="pp-age-wrap" style="display:none;">Kid or grown-up? <span style="color:#9ca3af;font-weight:400;">(so we draw them right)</span>
          <select class="pp-age" style="width:100%;margin-top:4px;padding:8px;border:1px solid #e6c9d6;border-radius:8px;font-size:14px;">
            <option value="child">Kid</option><option value="adult">Grown-up</option>
          </select>
        </label>
        <label>Their real name <span style="color:#9ca3af;font-weight:400;">(optional)</span>
          <input type="text" class="pp-given" placeholder="e.g. Gary" style="width:100%;margin-top:4px;padding:8px;border:1px solid #e6c9d6;border-radius:8px;font-size:14px;">
        </label>
        <label>Pronoun
          <select class="pp-pron" style="width:100%;margin-top:4px;padding:8px;border:1px solid #e6c9d6;border-radius:8px;font-size:14px;"><option value="">—</option>${o.pronouns.map(p => `<option value="${p}">${p}</option>`).join('')}</select>
        </label>
      </div>`;
    const q = s => el.querySelector(s);
    const rel = q('.pp-rel'), sideWrap = q('.pp-side-wrap'), birthWrap = q('.pp-birth-wrap');
    const ageWrap = q('.pp-age-wrap'), ageSel = q('.pp-age');
    function sync() {
      const r = byVal[rel.value] || {};
      sideWrap.style.display = r.side ? '' : 'none';
      birthWrap.style.display = r.sibling ? '' : 'none';
      // Kid/grown-up shows ONLY when the relationship doesn't settle it (a
      // sister can be 4 or 34); the portrait prompt adapts the art style by
      // age so adults don't get the style's big-eyed child proportions.
      // Pets have neither flag — age treatment doesn't apply to them.
      ageWrap.style.display = (!r.age && r.ageDefault) ? '' : 'none';
      if (!r.age && r.ageDefault) ageSel.value = r.ageDefault;
    }
    rel.addEventListener('change', sync); sync();

    return {
      getValues() {
        const r = byVal[rel.value] || {};
        return {
          displayName: q('.pp-display').value.trim(),
          relationship: rel.value,
          side: r.side ? (q('.pp-side').value || null) : null,
          birthOrder: r.sibling ? (parseInt(q('.pp-birth').value, 10) || null) : null,
          givenName: q('.pp-given').value.trim() || null,
          pronoun: q('.pp-pron').value || null,
          // 'adult' | 'child' | null. Unambiguous relationships answer for
          // themselves; the visible toggle answers for the rest.
          ageGroup: r.age || ((!r.age && r.ageDefault) ? ageSel.value : null),
        };
      },
      setValues(v) {
        v = v || {};
        q('.pp-display').value = v.displayName || v.display_name || '';
        rel.value = v.relationship || 'mother'; sync();
        q('.pp-side').value = v.side || '';
        q('.pp-birth').value = v.birthOrder || v.birth_order || '';
        q('.pp-given').value = v.givenName || v.given_name || '';
        q('.pp-pron').value = v.pronoun || '';
        const ag = v.ageGroup || v.age_group;
        if (ag === 'adult' || ag === 'child') ageSel.value = ag;
      },
      reset() { el.querySelectorAll('input').forEach(i => (i.value = '')); rel.selectedIndex = 0; sync(); },
    };
  }

  window.PeoplePicker = { getOptions, optionsHtml, mount };
})();
