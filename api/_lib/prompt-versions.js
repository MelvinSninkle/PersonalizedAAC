// Prompt version history. Before any code overwrites a taxonomy row's
// prompt_template, it calls savePromptVersion with the PRIOR value so the old
// text is never lost — a single bulk import can't silently wipe hand-tuned
// prompts again. Best-effort: a history write must never block or fail the edit.
export async function savePromptVersion(db, taxonomyId, priorPrompt, { by = 'admin', source = 'edit' } = {}) {
  const prompt = (priorPrompt == null ? '' : String(priorPrompt)).trim();
  if (!taxonomyId || !prompt) return;   // nothing to preserve
  try {
    await db`
      INSERT INTO taxonomy_prompt_versions (taxonomy_id, prompt_template, saved_by, source)
      VALUES (${taxonomyId}, ${prompt}, ${by}, ${source})
    `;
  } catch (_) { /* history is best-effort */ }
}
