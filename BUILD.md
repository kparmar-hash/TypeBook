# Typebook: a typed notebook with free placement

Build spec / prompt for Claude Code. Build exactly what is described here, in phases, and ask before deviating.

## 1. Goal

A desktop app for studying dense material (e.g. *The Art of Computer Programming*, Vol. 1) that feels like a paper notebook but is typed instead of handwritten.

- Click **anywhere** on a page and start typing. No text-box drawing, no resize handles.
- Multiple pages, organized into notebooks.
- Notes are clean, readable, and easy to copy out into other places.
- Notes stay in sync between a Mac and a Linux/Windows machine.
- Math is first-class (the material is math-heavy).

## 2. Stack (decided; do not re-litigate)

- **Shell:** Tauri 2 (Rust). Small, fast, native file access, builds for macOS, Windows, and Linux. The Rust side stays thin: file I/O, file watching, folder picker, window management. No heavy logic in Rust.
- **Frontend:** TypeScript + Svelte (or React if preferred) + Vite. Plain DOM for the page canvas (absolutely positioned elements). No canvas/WebGL needed.
- **Math:** KaTeX, bundled locally (no CDN).
- **Fonts:** bundle handwriting-style fonts locally (Caveat, Kalam, Patrick Hand) plus one clean sans and one monospace. App must work fully offline.
- **PDF (phase 3):** pdf.js, bundled.
- **Tests:** Vitest for the data/merge logic. Do not skip tests for the merge code.

## 3. Core interaction model

The page is a fixed-width sheet (about 850 px wide at 100% zoom) that scrolls vertically and extends as content is added. Content is a set of **text blocks** positioned by `(x, y)` of their top-left corner.

### Creating and editing text
- **Click empty space** → create a new block at that point and focus it. Text starts exactly where clicked.
- Blocks are **auto-sized**: width and height follow the content. No resize handles, ever. A block wraps only at the page's right margin.
- **Enter** → new line inside the same block (aligned to the block's left edge).
- **Esc** or **clicking empty space** → finish the block. Empty blocks are deleted automatically.
- **Click an existing block** → edit it, caret placed at the click point.
- **Snapping (toggleable, default on):** when clicking near the left edge or baseline of an existing block, snap to its x or to the ruled line grid so notes stay tidy. Hold `Alt` to disable snapping temporarily.

### Moving and deleting
- Hover a block → a small grab handle appears at its top-left. Drag to move.
- `Cmd/Ctrl+drag` on empty space → marquee select multiple blocks. Drag selected blocks together.
- Arrow keys nudge selected blocks (Shift = larger step). `Delete` removes them. Undo/redo for everything (`Cmd/Ctrl+Z`, `Shift+Z`).

### Inline formatting (rendered when the block is not being edited)
- `$...$` inline math and `$$...$$` display math via KaTeX. While editing, show raw text; on blur, render.
- `` `code` `` inline monospace.
- `**bold**`, `*italic*`, `==highlight==`.
- Lines starting with `- ` become bullets; `1. ` numbered lists.
- A block can be given a **style** from the right-click menu: Normal, Heading, Definition, Theorem, Exercise, Note. Each style is a subtle visual treatment (left bar, small label, tint), not a different editor.

### Handwriting feel
- Paper backgrounds: blank, ruled, dot grid, square grid (per page, with a notebook default).
- Handwriting font choice and size per notebook (default Caveat). Ink color choices (black, blue, red, green, pencil gray).
- Slight warm paper tone, soft page shadow on a neutral desk background. Dark mode with a dark "paper".
- Optional margin line on ruled paper.
- Math still renders cleanly in KaTeX (this is the "clean notes" part); the surrounding text can be handwriting-styled.

## 4. Organization

- **Notebooks** → **pages**. Left sidebar: notebook list, then page list with small thumbnails. Pages can be added, renamed, reordered by drag, duplicated, deleted (soft delete with undo).
- Each page has a title (optional) shown at the top-left in the sidebar and as a faint header on the sheet.
- **Tags** on pages, and full-text search across all notebooks (`Cmd/Ctrl+K`), including text inside math blocks.
- Quick keys: `Cmd/Ctrl+N` new page, `Cmd/Ctrl+[` / `]` previous/next page.

## 5. Copying notes out ("copy over and save in different places")

- Select blocks, then **Copy as Markdown** (math stays as `$...$`), **Copy as plain text**, or **Copy as image** (PNG of just the selection).
- Whole page: export as Markdown, PNG, or PDF. Whole notebook: export as a folder of Markdown files or a single PDF.
- Normal `Cmd/Ctrl+C` on a selection copies Markdown by default (configurable).
- Pasting text onto a page creates a block at the cursor or last click position. Pasting an image creates an image block that can be moved but not resized in a fiddly way (fixed width presets: S / M / L).
- Reading order for Markdown export: sort blocks by `y`, then `x`, grouping blocks whose `y` values are within half a line height.

## 6. Storage and sync (shared across Mac and Linux/Windows)

**Design: local-first, plain files in a folder the user picks. The app does not run its own server in v1.**

On first launch, ask the user to choose a **notes folder**. They point it at a folder synced by whatever they already use (iCloud Drive, Dropbox, OneDrive, Syncthing, a git repo). The app must work identically on all three OSes with that folder.

```
<notes-folder>/
  typebook.json                 # app/library metadata, schema version
  notebooks/
    <notebook-id>/
      notebook.json             # name, paper style, font, ink, page order
      pages/
        <page-id>.json          # one file per page
      assets/
        <asset-id>.png          # pasted images
```

One file per page keeps sync conflicts small. Do **not** use a single SQLite file in the synced folder (sync tools corrupt it). A local SQLite or in-memory index for search is fine, stored **outside** the synced folder (app data dir) and rebuilt from the files on startup.

### Page file schema

```json
{
  "schema": 1,
  "id": "pg_01H...",
  "title": "Ch 1.1 Algorithms",
  "paper": "ruled",
  "tags": ["taocp", "vol1"],
  "updatedAt": "2026-11-09T14:03:22.114Z",
  "blocks": [
    {
      "id": "b_01H...",
      "x": 96,
      "y": 140,
      "text": "Euclid's algorithm: $\\gcd(m,n)$ ...",
      "style": "definition",
      "ink": "blue",
      "updatedAt": "2026-11-09T14:03:22.114Z",
      "deleted": false
    }
  ],
  "images": []
}
```

### Rules
- IDs are ULIDs, generated client-side.
- Writes are **atomic**: write to a temp file in the same folder, then rename.
- Debounce saves (about 400 ms after the last change) and always save on blur/close.
- Deleted blocks and pages are kept as tombstones (`deleted: true`) for 30 days so sync merges do not resurrect them.
- A file watcher (Rust `notify` crate) detects external changes from the sync tool and reloads the affected page.

### Merge logic (the important part)
When a page file changes on disk while it is open, or when a sync tool produces conflict copies (e.g. `page (conflicted copy).json`, `page.sync-conflict-...json`):

1. Load both versions.
2. Merge **per block by `id`**: the version with the newer `updatedAt` wins; tombstones win over older edits.
3. Union blocks that exist in only one version.
4. Page-level fields (title, tags, paper): newest `updatedAt` wins.
5. Write the merged result, move the conflict copy to `<notes-folder>/.conflicts/`, and show a small non-blocking toast ("Merged changes from another device").

Unit test this with: two devices editing different blocks, the same block, a delete vs. an edit, and offline-edit-then-reconnect.

### Optional later: hosted sync
Design the storage layer behind an interface (`PageStore`) so a Supabase/Postgres backend can be added later for real-time sync without touching the UI. Do not build it in v1.

## 7. PDF study companion (phase 3)

- Split view: open any local PDF (the TAOCP PDF) in a side pane with pdf.js. Page navigation, zoom, text search.
- A block can store an optional `ref: { pdf: "<file hash>", page: 52 }`. A small chip on the block opens the PDF at that page.
- "Link to current PDF page" on a block, and a setting to auto-attach the current PDF page to new blocks.
- Copying text from the PDF and pasting onto the notes page creates a quoted block (muted style) with the source page filled in.
- PDF paths are stored per device (they differ between machines); the library stores only the file hash and a display name.

## 8. Build phases (stop and let me test after each)

**Phase 1: the notebook feel**
- Tauri scaffold, notes-folder picker, notebook and page CRUD, sidebar.
- Click-anywhere text blocks, auto-size, Enter for new line, move/select/delete, undo/redo.
- Paper styles, handwriting fonts, ink colors, dark mode.
- KaTeX inline and display math.
- Atomic saves to the page JSON schema above.

**Phase 2: sync and getting notes out**
- File watcher, merge logic with tests, conflicts folder, toast.
- Copy as Markdown/text/image, page and notebook export, search, tags.
- Image paste, block styles (Definition, Theorem, Exercise, Note).

**Phase 3: PDF companion**
- pdf.js split view, page refs on blocks, quoted-paste blocks.

## 9. Non-goals

- No pen/ink/drawing tools.
- No resizable text boxes, no rotation, no free-form shapes.
- No accounts, no required server, no telemetry.
- No mobile app in v1.

## 10. Quality bar

- Typing latency must feel instant; no re-render of the whole page per keystroke.
- A page with 500 blocks must stay smooth (virtualize rendering of off-screen blocks if needed).
- Never lose data: if a save fails, keep the in-memory page, retry, and show an error.
- Keyboard-first: every action has a shortcut, and the list lives in a `?` overlay.
- Ship with a short README covering how to build on macOS, Windows, and Linux (`npm install`, `npm run tauri dev`, `npm run tauri build`) and how to set up the synced folder.