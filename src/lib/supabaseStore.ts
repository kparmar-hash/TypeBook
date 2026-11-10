import { differs } from './canonical';
import { scrubPage } from './tombstones';
import type { ExternalChange, Library, Notebook, Page, PageStore } from './types';

const TOMBSTONE_MS = 30 * 24 * 3600 * 1000;
const NOTEBOOK_ID = /^nb_[0-9A-Z]{26}$/;
const ASSET_NAME = /^[0-9A-Z]{26}\.(png|jpe?g|gif|webp)$/;
const OVERLAP_MS = 5000;

export type Row = Record<string, any>;
export type Table = 'notebooks' | 'pages' | 'pdfs';

/**
 * The few things the store needs from a Supabase project. `supabaseRemote.ts` implements this with
 * supabase-js; the tests implement it on a real Postgres running the migration.
 */
export interface Remote {
  userId(): string;
  rpc(fn: 'save_page' | 'save_notebook' | 'purge_tombstones', args: Record<string, unknown>): Promise<any>;
  select(table: Table, q?: { eq?: Record<string, string>; gt?: Record<string, string> }): Promise<Row[]>;
  insertPdfs(rows: { hash: string; name: string }[]): Promise<void>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  /** Live row changes for this user. `onStatus('up')` fires on every (re)connection. */
  subscribe(onRow: (table: 'notebooks' | 'pages', row: Row) => void, onStatus: (s: 'up' | 'down') => void): Promise<() => void>;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const expired = (iso: string) => Date.now() - Date.parse(iso) > TOMBSTONE_MS;
const iso = (v: unknown) => new Date(v as string).toISOString();

export function rowToNotebook(r: Row): Notebook {
  return {
    schema: 1,
    id: r.id,
    name: r.name,
    paper: r.paper,
    font: r.font,
    fontSize: r.font_size,
    ink: r.ink,
    margin: r.margin,
    pageOrder: r.page_order ?? [],
    updatedAt: iso(r.updated_at),
    ...(r.deleted ? { deleted: true } : {}),
  };
}

export function rowToPage(r: Row): Page {
  return {
    schema: 1,
    id: r.id,
    title: r.title,
    paper: r.paper,
    tags: r.tags ?? [],
    updatedAt: iso(r.updated_at),
    blocks: r.blocks ?? [],
    images: r.images ?? [],
    ...(r.deleted ? { deleted: true } : {}),
  };
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Storage in a Supabase project. Writes go through the merging `save_*` functions, so devices never overwrite each other. */
export class SupabaseStore implements PageStore {
  private cursor = 0; // newest server write time (ms) we have seen
  private onChange: ((c: ExternalChange) => void) | null = null;
  private purged = false;

  constructor(private remote: Remote) {}

  private seen(rows: Row[]) {
    for (const r of rows) {
      const t = Date.parse(r.synced_at);
      if (t > this.cursor) this.cursor = t;
    }
  }

  async init() {}

  // ---------- library (PDF registry) ----------

  async loadLibrary(): Promise<Library> {
    const rows = await this.remote.select('pdfs');
    return { schema: 1, createdAt: new Date(0).toISOString(), pdfs: Object.fromEntries(rows.map((r) => [r.hash, { name: r.name }])) };
  }

  async saveLibrary(lib: Library): Promise<Library> {
    const rows = Object.entries(lib.pdfs ?? {}).map(([hash, v]) => ({ hash, name: v.name }));
    if (rows.length) await this.remote.insertPdfs(rows);
    return { ...lib, pdfs: { ...(lib.pdfs ?? {}), ...(await this.loadLibrary()).pdfs } };
  }

  // ---------- notebooks ----------

  async listNotebooks(): Promise<Notebook[]> {
    if (!this.purged) {
      this.purged = true;
      await this.remote.rpc('purge_tombstones', {}).catch(() => {}); // housekeeping must never block opening
    }
    const rows = await this.remote.select('notebooks');
    this.seen(rows);
    return rows.map(rowToNotebook);
  }

  async saveNotebook(nb: Notebook): Promise<void> {
    await this.remote.rpc('save_notebook', { p_notebook: nb });
  }

  async deleteNotebook(id: string): Promise<void> {
    const [row] = await this.remote.select('notebooks', { eq: { id } });
    if (row) await this.saveNotebook({ ...rowToNotebook(row), deleted: true, updatedAt: new Date().toISOString() });
  }

  // ---------- pages ----------

  async listPages(notebookId: string): Promise<Page[]> {
    const rows = await this.remote.select('pages', { eq: { notebook_id: notebookId } });
    this.seen(rows);
    const pages: Page[] = [];
    for (const r of rows) {
      const page = rowToPage(r);
      if (page.deleted && expired(page.updatedAt)) continue;
      page.blocks = page.blocks.filter((b) => !(b.deleted && expired(b.updatedAt)));
      page.images = page.images.filter((i) => !(i.deleted && expired(i.updatedAt)));
      pages.push(page);
    }
    return pages;
  }

  async savePage(notebookId: string, page: Page): Promise<Page | null> {
    if (!NOTEBOOK_ID.test(notebookId)) throw new Error('Invalid notebook id');
    const merged = (await this.remote.rpc('save_page', { p_notebook_id: notebookId, p_page: page })) as Page;
    merged.blocks ??= [];
    merged.images ??= [];
    // the server empties deleted content, so compare with what it would keep, not with what we sent
    return differs(merged, scrubPage(page)) ? merged : null;
  }

  async resolveConflicts(): Promise<number> {
    return 0; // the server merges on every write; there are no conflict copies
  }

  // ---------- assets (private storage bucket, one folder per user) ----------

  private assetPath(notebookId: string, asset: string) {
    if (!NOTEBOOK_ID.test(notebookId) || !ASSET_NAME.test(asset)) throw new Error('Invalid asset name');
    return `${this.remote.userId()}/${notebookId}/${asset}`;
  }

  async readAsset(notebookId: string, asset: string): Promise<string> {
    const bytes = await this.remote.download(this.assetPath(notebookId, asset));
    const ext = asset.split('.').pop()!.toLowerCase();
    return `data:${MIME[ext]};base64,${toBase64(bytes)}`;
  }

  async writeAsset(notebookId: string, asset: string, base64: string): Promise<void> {
    const path = this.assetPath(notebookId, asset);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    await this.remote.upload(path, bytes, MIME[asset.split('.').pop()!.toLowerCase()]);
  }

  // ---------- live updates from other devices ----------

  private async deliver(table: 'notebooks' | 'pages', row: Row) {
    if (!this.onChange) return;
    if (table === 'notebooks') {
      this.seen([row]);
      return void this.onChange({ type: 'notebook', notebook: rowToNotebook(row), conflict: false });
    }
    // Realtime can leave out large columns; fetch the full row in that case.
    if (typeof row.blocks !== 'object' || row.blocks === null) {
      const [full] = await this.remote.select('pages', { eq: { id: row.id } });
      if (!full) return;
      row = full;
    }
    this.seen([row]);
    this.onChange({ type: 'page', nbId: row.notebook_id, page: rowToPage(row), conflict: false });
  }

  async watch(onChange: (c: ExternalChange) => void): Promise<() => void> {
    this.onChange = onChange;
    const stop = await this.remote.subscribe(
      (table, row) => void this.deliver(table, row).catch(() => {}),
      (s) => s === 'up' && void this.refresh().catch(() => {}),
    );
    return () => {
      this.onChange = null;
      stop();
    };
  }

  /** Fetch everything written since we last heard from the server (with a margin for clock and commit ordering). */
  async refresh(): Promise<void> {
    if (!this.onChange || !this.cursor) return;
    const since = new Date(this.cursor - OVERLAP_MS).toISOString();
    for (const table of ['notebooks', 'pages'] as const) {
      for (const row of await this.remote.select(table, { gt: { synced_at: since } })) await this.deliver(table, row);
    }
  }
}
