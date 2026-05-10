# Personalized AAC

A minimal, single-file Augmentative and Alternative Communication web app for a non-verbal child who is a gestalt language processor. Tap an image, hear an associated sound — typically a personalized phrase rather than a single word.

## Run

Open `index.html` directly in Chrome (double-click works), or deploy as static files (e.g. GitHub Pages) and open the URL. No build step. Pure HTML + CSS + vanilla JavaScript. All state stored in the browser's IndexedDB.

## Login

Admin (caregiver) features are gated behind a hardcoded login button in the header.

- Username: `admin`
- Password: `password`

POC-grade only — replace before broader use.

## Layout

Three sections side-by-side, each with a tab strip for categories on top and an items grid below:

| Section | Columns | Purpose                              |
|---------|---------|--------------------------------------|
| People  | 1       | Who — Fletcher pinned at top         |
| Nouns   | 4       | What — objects, places, etc.         |
| Verbs   | 2       | Actions / states                     |

The active category's items fill the section's full N-column grid below the tab strip. Items distribute row-major (item 0 → col 0, item 1 → col 1, …) with each column scrolling independently and scrollbars hidden.

For the People section (1 col), the single tab cycles to the next category on click. For Nouns/Verbs (4/2 cols), each tab slot is its own category — clicking an inactive tab activates it.

## Data model (IndexedDB v2)

Two object stores, both with auto-incrementing `id` and a `section` index.

**`categories`** — `{ id, section, label, image: Blob, order }`
- `section` ∈ {`people`, `nouns`, `verbs`}
- Active category per section is in-memory state, not persisted.

**`items`** — `{ id, section, categoryId, label, image: Blob, sound: Blob, order, pinned }`
- `categoryId` references a `categories.id` in the same section.
- `pinned` only meaningful in People; pinned items sort before unpinned.

## Admin (edit mode) features

Available after Login:

- `+ Add Category` placeholder in empty tab slots; `+ New Category` button at section bottom
- `+ Add Item` tile at the bottom of column 0 in each section
- `✎` badge on every tile to edit or delete
- Drag-and-drop reordering of item tiles (HTML5 DnD; mouse only — see limitations)
- **Export** button: downloads JSON with images/sounds base64-embedded
- **Import** button: loads a previous Export, replacing all data on this device

## Migration between devices

IndexedDB is per-origin. A locally-opened `file://` copy and a deployed `*.github.io` URL are different origins with separate storage. To move data across devices/origins: Export on source → copy JSON → Import on target.

## Privacy / what NOT to commit

`.gitignore` excludes:
- `Images/` — local source images, may include the user's child
- `Sounds/` — local source audio, may include family voice recordings
- `*.json` — backup exports include the same content base64-encoded
- `.claude/` — Claude Code metadata

The app does not read these directories at runtime; uploaded media goes straight into IndexedDB. They exist only as the parent's working pile.

## Known limitations

- **Touchscreen drag-to-reorder is unreliable.** HTML5 DnD has flaky touch support. Switch to pointer-event-based drag if needed for tablet use.
- **Hardcoded admin credentials.** Fine on a private device, not secure for broader deployment.
- **No multi-device sync.** Each browser/device has its own IndexedDB; Export/Import is the only path between them.
- **No undo for delete.** Deleting a category cascades to its items, gated behind a confirm dialog.

## File structure

```
index.html      Entire app — HTML, CSS, JS in one file
README.md       This file
.gitignore      Excludes media folders and backups
```
