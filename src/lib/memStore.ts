import { mergeLibraries, mergePages } from './merge';
import type { ExternalChange, Library, Notebook, Page, PageStore } from './types';

const KEY = 'typebook-browser-demo';

interface Data {
  library?: Library;
  notebooks: Record<string, Notebook>;
  pages: Record<string, Record<string, Page>>;
  assets: Record<string, string>;
}

/** localStorage-backed store so the UI can run in a plain browser (`npm run dev`) without Tauri. */
export class MemoryStore implements PageStore {
  private load(): Data {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) ?? '') as Data;
      d.assets ??= {};
      return d;
    } catch {
      return { notebooks: {}, pages: {}, assets: {} };
    }
  }
  private save(d: Data) {
    localStorage.setItem(KEY, JSON.stringify(d));
  }
  async init() {}
  async loadLibrary() {
    return this.load().library ?? { schema: 1 as const, createdAt: new Date().toISOString() };
  }
  async saveLibrary(lib: Library) {
    const d = this.load();
    d.library = d.library ? mergeLibraries(lib, d.library) : lib;
    this.save(d);
    return d.library;
  }
  async listNotebooks() {
    return Object.values(this.load().notebooks);
  }
  async saveNotebook(nb: Notebook) {
    const d = this.load();
    d.notebooks[nb.id] = nb;
    this.save(d);
  }
  async deleteNotebook(id: string) {
    const d = this.load();
    if (d.notebooks[id]) d.notebooks[id].deleted = true;
    this.save(d);
  }
  async listPages(nbId: string) {
    return Object.values(this.load().pages[nbId] ?? {});
  }
  async savePage(nbId: string, page: Page) {
    const d = this.load();
    const stored = d.pages[nbId]?.[page.id];
    const out = stored ? mergePages(page, stored) : page; // another tab may have saved since we looked
    (d.pages[nbId] ??= {})[page.id] = out;
    this.save(d);
    return JSON.stringify(out) === JSON.stringify(page) ? null : out;
  }
  /** Other browser tabs on the same storage act like other devices. */
  async watch(onChange: (c: ExternalChange) => void) {
    const handler = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      const next = JSON.parse(e.newValue) as Data;
      const prev: Data = e.oldValue ? JSON.parse(e.oldValue) : { notebooks: {}, pages: {}, assets: {} };
      for (const [id, notebook] of Object.entries(next.notebooks))
        if (JSON.stringify(notebook) !== JSON.stringify(prev.notebooks?.[id]))
          onChange({ type: 'notebook', notebook, conflict: false });
      for (const [nbId, pages] of Object.entries(next.pages))
        for (const [id, page] of Object.entries(pages))
          if (JSON.stringify(page) !== JSON.stringify(prev.pages?.[nbId]?.[id]))
            onChange({ type: 'page', nbId, page, conflict: false });
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
  async resolveConflicts() {
    return 0;
  }
  async readAsset(nbId: string, asset: string) {
    return this.load().assets[`${nbId}/${asset}`] ?? '';
  }
  async writeAsset(nbId: string, asset: string, base64: string) {
    const d = this.load();
    const ext = asset.split('.').pop() ?? 'png';
    d.assets[`${nbId}/${asset}`] = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`;
    this.save(d);
  }
}
