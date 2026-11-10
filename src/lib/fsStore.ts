import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { conflictBase, isPageFile, mergeLibraries, mergeNotebooks, mergePages } from './merge';
import type { ExternalChange, Library, Notebook, Page, PageStore } from './types';

const TOMBSTONE_MS = 30 * 24 * 3600 * 1000;

interface Entry {
  name: string;
  is_dir: boolean;
}

const join = (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/');

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const expired = (updatedAt: string) => Date.now() - Date.parse(updatedAt) > TOMBSTONE_MS;

/** Plain-files storage in a user-chosen (usually synced) folder. */
export class FsPageStore implements PageStore {
  /** Last contents we wrote or read per path; lets us tell our own writes from a sync tool's. */
  private seen = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private root: string) {}

  private nbDir = (id: string) => join(this.root, 'notebooks', id);
  private pagesDir = (nb: string) => join(this.nbDir(nb), 'pages');
  private pagePath = (nb: string, id: string) => join(this.pagesDir(nb), id + '.json');
  private nbPath = (id: string) => join(this.nbDir(id), 'notebook.json');

  private async readRaw(path: string): Promise<string | null> {
    try {
      return await invoke<string>('read_text', { path });
    } catch {
      return null;
    }
  }

  /** Read and parse; remembers the raw contents so a later identical change event is recognised as ours. */
  private async readJson<T>(path: string): Promise<T | null> {
    const raw = await this.readRaw(path);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as T;
      this.seen.set(path, raw);
      return value;
    } catch {
      return null;
    }
  }

  private async writeJson(path: string, value: unknown) {
    const contents = JSON.stringify(value, null, 2);
    await invoke<void>('write_atomic', { path, contents });
    this.seen.set(path, contents);
  }

  async init() {
    await invoke('make_dir', { path: join(this.root, 'notebooks') });
    const libPath = join(this.root, 'typebook.json');
    if (!(await invoke<boolean>('path_exists', { path: libPath }))) {
      const lib: Library = { schema: 1, createdAt: new Date().toISOString() };
      await this.writeJson(libPath, lib);
    }
  }

  private libPath = () => join(this.root, 'typebook.json');

  async loadLibrary(): Promise<Library> {
    return (await this.readJson<Library>(this.libPath())) ?? { schema: 1, createdAt: new Date().toISOString() };
  }

  async saveLibrary(lib: Library): Promise<Library> {
    const disk = await this.readJson<Library>(this.libPath());
    const merged = disk ? mergeLibraries(lib, disk) : lib;
    await this.writeJson(this.libPath(), merged);
    return merged;
  }

  async listNotebooks(): Promise<Notebook[]> {
    const entries = await invoke<Entry[]>('list_dir', { path: join(this.root, 'notebooks') });
    const out: Notebook[] = [];
    for (const e of entries.filter((e) => e.is_dir)) {
      await this.resolveNotebookConflicts(e.name);
      const nb = await this.readJson<Notebook>(this.nbPath(e.name));
      if (nb && !(nb.deleted && expired(nb.updatedAt))) out.push(nb);
      else if (nb) await invoke('remove_path', { path: this.nbDir(e.name) });
    }
    return out;
  }

  saveNotebook(nb: Notebook) {
    return this.writeJson(this.nbPath(nb.id), nb);
  }

  async deleteNotebook(id: string) {
    const nb = await this.readJson<Notebook>(this.nbPath(id));
    if (nb) await this.saveNotebook({ ...nb, deleted: true, updatedAt: new Date().toISOString() });
  }

  async listPages(notebookId: string): Promise<Page[]> {
    const dir = this.pagesDir(notebookId);
    if (!(await invoke<boolean>('path_exists', { path: dir }))) return [];
    const entries = await invoke<Entry[]>('list_dir', { path: dir });
    const pages: Page[] = [];
    for (const e of entries) {
      if (!isPageFile(e.name)) continue;
      const path = join(dir, e.name);
      const page = await this.readJson<Page>(path);
      if (!page) continue;
      if (page.deleted && expired(page.updatedAt)) {
        await invoke('remove_path', { path });
        continue;
      }
      page.blocks = (page.blocks ?? []).filter((b) => !(b.deleted && expired(b.updatedAt)));
      page.images = (page.images ?? []).filter((i) => !(i.deleted && expired(i.updatedAt)));
      pages.push(page);
    }
    return pages;
  }

  async savePage(notebookId: string, page: Page): Promise<Page | null> {
    const path = this.pagePath(notebookId, page.id);
    // If a sync tool changed the file since we last saw it, fold that in instead of overwriting it.
    const raw = await this.readRaw(path);
    let out = page;
    let merged: Page | null = null;
    if (raw !== null && raw !== this.seen.get(path)) {
      try {
        const disk = JSON.parse(raw) as Page;
        out = mergePages(page, disk);
        if (JSON.stringify(out) !== JSON.stringify(page)) merged = out;
      } catch {
        /* unreadable (e.g. mid-sync): overwrite */
      }
    }
    await this.writeJson(path, out);
    return merged;
  }

  // ---------- conflicts ----------

  private async moveToConflicts(copyPath: string, nbId: string, name: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await invoke('move_path', { from: copyPath, to: join(this.root, '.conflicts', `${stamp}-${nbId}-${name}`) });
  }

  /** Merge a conflict copy into its base file, then park the copy in `.conflicts/`. */
  private async mergeCopy<T>(
    nbId: string,
    dir: string,
    copyName: string,
    baseName: string,
    merge: (a: T, b: T) => T,
  ): Promise<boolean> {
    const copyPath = join(dir, copyName);
    const copy = await this.readJson<T>(copyPath);
    if (!copy) return false; // unreadable: probably still syncing, leave it alone
    const basePath = join(dir, baseName);
    const base = await this.readJson<T>(basePath);
    await this.writeJson(basePath, base ? merge(base, copy) : copy);
    await this.moveToConflicts(copyPath, nbId, copyName);
    return true;
  }

  private async resolveNotebookConflicts(nbId: string): Promise<number> {
    const dir = this.nbDir(nbId);
    let n = 0;
    for (const e of await invoke<Entry[]>('list_dir', { path: dir }).catch(() => [])) {
      const c = !e.is_dir && conflictBase(e.name);
      if (c && c.kind === 'notebook' && (await this.mergeCopy<Notebook>(nbId, dir, e.name, c.base, mergeNotebooks))) n++;
    }
    return n;
  }

  async resolveConflicts(notebookId: string): Promise<number> {
    let n = await this.resolveNotebookConflicts(notebookId);
    const dir = this.pagesDir(notebookId);
    if (!(await invoke<boolean>('path_exists', { path: dir }))) return n;
    for (const e of await invoke<Entry[]>('list_dir', { path: dir })) {
      const c = !e.is_dir && conflictBase(e.name);
      if (c && c.kind === 'page' && (await this.mergeCopy<Page>(notebookId, dir, e.name, c.base, mergePages))) n++;
    }
    return n;
  }

  // ---------- assets ----------

  async readAsset(notebookId: string, asset: string) {
    const b64 = await invoke<string>('read_base64', { path: join(this.nbDir(notebookId), 'assets', asset) });
    const ext = asset.split('.').pop()?.toLowerCase() ?? 'png';
    return `data:${MIME[ext] ?? 'image/png'};base64,${b64}`;
  }

  async writeAsset(notebookId: string, asset: string, base64: string) {
    await invoke('write_base64', { path: join(this.nbDir(notebookId), 'assets', asset), data: base64 });
  }

  // ---------- watching ----------

  async watch(onChange: (c: ExternalChange) => void) {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const handle = async (abs: string) => {
      const rel = abs.replace(/\\/g, '/').replace(this.root.replace(/\\/g, '/'), '').replace(/^\/+/, '');
      const m = /^notebooks\/([^/]+)\/(?:(pages)\/)?([^/]+\.json)$/.exec(rel);
      if (!m || m[3].startsWith('.')) return;
      const [, nbId, inPages, file] = m;
      const path = join(this.root, rel);

      if (inPages) {
        const c = conflictBase(file);
        if (c?.kind === 'page') {
          if (!(await this.mergeCopy<Page>(nbId, this.pagesDir(nbId), file, c.base, mergePages))) return;
          const page = await this.readJson<Page>(join(this.pagesDir(nbId), c.base));
          if (page) onChange({ type: 'page', nbId, page, conflict: true });
        } else if (isPageFile(file)) {
          const raw = await this.readRaw(path);
          if (raw === null || raw === this.seen.get(path)) return; // gone, or our own write
          const page = await this.readJson<Page>(path);
          if (page) onChange({ type: 'page', nbId, page, conflict: false });
        }
        return;
      }

      const c = conflictBase(file);
      if (c?.kind === 'notebook') {
        if (!(await this.mergeCopy<Notebook>(nbId, this.nbDir(nbId), file, c.base, mergeNotebooks))) return;
        const notebook = await this.readJson<Notebook>(this.nbPath(nbId));
        if (notebook) onChange({ type: 'notebook', notebook, conflict: true });
      } else if (file === 'notebook.json') {
        const raw = await this.readRaw(path);
        if (raw === null || raw === this.seen.get(path)) return;
        const notebook = await this.readJson<Notebook>(path);
        if (notebook) onChange({ type: 'notebook', notebook, conflict: false });
      }
    };

    const flush = () => {
      const paths = [...pending];
      pending.clear();
      this.queue = this.queue.then(async () => {
        for (const p of paths) await handle(p).catch(() => {});
      });
    };

    const unlisten = await listen<string[]>('fs-changed', (ev) => {
      let relevant = false;
      for (const p of ev.payload) {
        const name = p.replace(/\\/g, '/').split('/').pop() ?? '';
        if (name.startsWith('.') || !name.endsWith('.json')) continue;
        pending.add(p);
        relevant = true;
      }
      if (relevant) {
        clearTimeout(timer);
        timer = setTimeout(flush, 250);
      }
    });
    await invoke('watch_folder', { path: this.root });
    return unlisten;
  }
}
