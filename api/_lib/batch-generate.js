// Reusable batch image-generation engine. The SAME ordering + concurrency logic
// powers both the admin Lab's bulk generate AND new-customer onboarding (default
// board generation), so paired tiles stay visually consistent everywhere.
//
// Two pieces, both pure of any HTTP/DB specifics:
//   planGenerationGroups(rows) — group tiles into dependency-ordered sets so
//     related/paired tiles (has_relationship + related_images) generate together,
//     alphabetically, the earlier image feeding the later for a shared setup.
//   runGroups(...) — run those groups through a concurrency pool, threading each
//     group member's output blob key into the next member as a reference.
//
// The caller injects `render(row, { referenceImageKeys }) => { ok, blobKey, ... }`,
// so the Lab (records tile_generations) and onboarding (sets the board item) can
// each supply their own per-tile renderer while sharing the orchestration.

// Build dependency-ordered groups from taxonomy rows. `rows` need {id, related_images}.
// related_images is treated as an undirected graph; each connected component becomes
// one group, members sorted alphabetically by id (deterministic; matches §7 — the
// earlier word generates first and seeds the later). Tiles with no relations are
// singleton groups.
export function planGenerationGroups(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rel = (r) => (Array.isArray(r.related_images) ? r.related_images
    : typeof r.related_images === 'string' && r.related_images
      ? r.related_images.split(/\s*\|\s*|,/).map((s) => s.trim()).filter(Boolean)
      : []);
  const seen = new Set();
  const groups = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    // BFS the relation graph, but only across ids that are actually in this batch.
    const comp = [];
    const queue = [r.id];
    seen.add(r.id);
    while (queue.length) {
      const id = queue.shift();
      comp.push(id);
      const row = byId.get(id);
      if (!row) continue;
      for (const nid of rel(row)) {
        if (byId.has(nid) && !seen.has(nid)) { seen.add(nid); queue.push(nid); }
      }
    }
    comp.sort();              // alphabetical → earlier word seeds later
    groups.push(comp);
  }
  return groups;
}

// Run groups through a pool. `concurrency` groups run at once; WITHIN a group the
// members are generated in order, each receiving the prior members' blob keys as
// `referenceImageKeys` (so "open" reuses "close"'s setup). `render` returns
// { ok, blobKey?, costCents?, error? }. `onProgress(done, total, result)` is called
// after each tile. Returns a Map id -> result. Best-effort: one tile's failure
// never sinks the batch (and never blocks its group's later members — they just
// generate without that reference).
export async function runGroups({ groups, byId, concurrency = 4, render, onProgress }) {
  const results = new Map();
  const total = groups.reduce((n, g) => n + g.length, 0);
  let done = 0;
  let gi = 0;
  async function worker() {
    while (gi < groups.length) {
      const group = groups[gi++];
      const refKeys = [];
      for (const id of group) {
        const row = byId.get(id);
        let res;
        try {
          res = await render(row, { referenceImageKeys: refKeys.slice() });
        } catch (err) {
          res = { ok: false, error: String(err && err.message || err) };
        }
        results.set(id, res);
        if (res && res.ok && res.blobKey) refKeys.push(res.blobKey);
        done++;
        if (onProgress) { try { onProgress(done, total, { id, ...res }); } catch (_) {} }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));
  return results;
}
