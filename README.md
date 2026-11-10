# Typebook

A typed notebook with free placement: click anywhere on a page and type. Math is rendered with KaTeX, notes are plain JSON files in a folder you choose, and everything works offline.

Status: **Phase 3** (PDF study companion). All three phases in `BUILD.md` are built.

## Build

Requirements: Node 20+, Rust (stable), and the Tauri 2 system dependencies for your OS
(<https://v2.tauri.app/start/prerequisites/>).

```sh
npm install
npm run tauri dev      # run the desktop app with hot reload
npm run tauri build    # produce an installer / bundle for the current OS
```

### macOS
Install Xcode Command Line Tools (`xcode-select --install`) and Rust, then the commands above.

### Windows
Install Microsoft C++ Build Tools (Desktop development with C++), WebView2 (preinstalled on Windows 11) and Rust, then the commands above.

### Linux
Install the WebKitGTK stack. Arch: `sudo pacman -S webkit2gtk-4.1 base-devel librsvg`.
Debian/Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev`.

### Other scripts
```sh
npm test         # Vitest (merge logic, folder store, search, export, markup, undo)
npm run check    # svelte-check / TypeScript
npm run dev      # frontend only in a browser, backed by localStorage (UI work without Tauri)
```

## Using Supabase (accounts and sync between devices)

1. Create a Supabase project. In the SQL Editor run, in order, `supabase/migrations/20261109000000_init.sql` and then `supabase/migrations/20261110000000_scrub_deleted.sql`. Both are safe to re-run.
2. `cp .env.example .env`, then fill in `VITE_SUPABASE_URL` and the **publishable/anon** key. Never put a `service_role` / `sb_secret_` key in the app: it refuses to start if it finds one.
3. In Supabase → Authentication, keep *Confirm email* on, and turn off *Allow new users to sign up* once your own account exists.
4. Start the app, create an account, confirm the email, sign in. On another machine use the same `.env` values and the same account.

With `.env` left empty the app runs without Supabase (notes in a local folder, below).

**Deleting:** a deleted page, block or notebook is emptied on the server straight away. A bare row with `deleted = true` remains for 30 days so a device that was offline cannot bring it back, then it is removed. Undo works throughout. Pasted image files are not removed from Storage when you delete a page.

**Unsent changes:** if a save fails (offline, expired session) the page is kept on that device and sent later, including on the next start.

## Setting up the synced folder

On first launch Typebook asks for a **notes folder**. Choose a folder that your existing sync tool already covers (iCloud Drive, Dropbox, OneDrive, Syncthing, a git repo) and pick the same synced folder on each machine. Typebook never runs a server.

```
<notes-folder>/
  typebook.json
  notebooks/<notebook-id>/notebook.json
  notebooks/<notebook-id>/pages/<page-id>.json   one file per page, written atomically
```

Typebook watches the folder. When your sync tool changes a page file while the app is open, the page is merged live (a small toast says "Merged changes from another device"). When the tool leaves a conflict copy next to a page (`… (conflicted copy).json`, `….sync-conflict-….json`, `… 2.json`), Typebook merges it into the real file and moves the copy to `<notes-folder>/.conflicts/`.

Merging is per block: the version with the newer `updatedAt` wins, deletions are kept as tombstones for 30 days so they do not come back, and blocks that exist on only one side are kept. Page title, tags and paper come from the newer page.

Images you paste are stored in `notebooks/<id>/assets/`.

## Getting notes out

- Select blocks and press `Ctrl/Cmd+C` to copy them as Markdown (math stays as `$…$`). Use `Ctrl/Cmd+Shift+M / T / I` for Markdown, plain text, or a PNG of just the selection. The Export menu (`Ctrl/Cmd+E`) switches what plain `Ctrl/Cmd+C` copies.
- Export a page as Markdown, PNG or PDF, or a whole notebook as a folder of Markdown files or one PDF, from the Export menu. Exports always use light paper.
- `Ctrl/Cmd+K` searches every notebook (titles, text, TeX source, `#tags`).

## Reading a PDF beside your notes

`Ctrl/Cmd+Shift+P` (or the **PDF** button) opens a split view with any local PDF. Turn pages with the arrows, zoom with `+` / `-` / `0` (fit width), and search the whole document from the pane's search box (`Enter` / `Shift+Enter` for next / previous).

- **Cite a page:** right-click a block and choose *Link to PDF page*, or press `Ctrl/Cmd+Shift+L`. The block gets a small `p.52` chip; clicking it opens the PDF at that page. Tick *Link new blocks* in the pane to attach the current page to every block you create.
- **Quote from the PDF:** select text in the pane, copy it, and paste onto a page. It becomes a muted *Quote* block with its source page filled in (line wraps and end-of-line hyphens are cleaned up).
- **Sync-safe:** notes store only a content hash of the PDF and its display name (in `typebook.json`). The file's location is kept per device, so each machine can keep the PDF wherever it likes. On a machine that does not know where it is, clicking a chip asks you to locate the file once.
- Markdown export cites sources: `> quoted text` followed by `> — *TAOCP vol 1.pdf, p. 52*`.

## Using it

Press `?` in the app for the full shortcut list. Highlights: click empty space to start a block; `Esc` finishes it; `$…$` / `$$…$$` for math; drag the handle that appears at a block's top-left to move it; `Ctrl/Cmd`+drag to marquee select; `Ctrl/Cmd+Z` undo; `Ctrl/Cmd+N` new page; `Ctrl/Cmd+[` / `]` switch pages.
