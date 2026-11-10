import { SvelteSet } from 'svelte/reactivity';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { createSupabaseClient, supabaseClient } from './auth.svelte';
import { differs } from './canonical';
import { readSupabaseConfig, type SupabaseEnv } from './env';
import { FsPageStore } from './fsStore';
import { Outbox } from './outbox';
import { SupabaseStore } from './supabaseStore';
import { scrubNotebook, scrubPage } from './tombstones';
import { createSupabaseRemote } from './supabaseRemote';
import { MemoryStore } from './memStore';
import { History, restoreBlocks, sameSnapshot, snapshotOf, type Snapshot } from './history';
import { mergeNotebooks, mergePages } from './merge';
import { pdf, pdfRef } from './pdfState.svelte';
import { entryOf, type IndexEntry } from './search';
import { newBlockId, newImageId, newAssetName, newNotebookId, newPageId } from './ulid';
import type {
  Block,
  BlockStyle,
  ExternalChange,
  ImageItem,
  ImageSize,
  Ink,
  Library,
  Notebook,
  Page,
  PageStore,
  PdfRef,
} from './types';

export const PAGE_W = 850;
export const RIGHT_MARGIN = 40;
export const TOP = 64;
export const MARGIN_X = 72;

export const lineHeightOf = (nb: Pick<Notebook, 'fontSize'>) => Math.round(nb.fontSize * 1.45);

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

type Theme = 'system' | 'light' | 'dark';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export const app = $state({
  root: null as string | null,
  loading: true,
  /** which list the sidebar shows: all notebooks, or the pages of the open one */
  view: 'notebooks' as 'notebooks' | 'pages',
  /** where notes live: a local folder (or browser demo) or the Supabase project */
  backend: 'folder' as 'folder' | 'supabase',
  /** signed-in account email (Supabase backend) */
  user: null as string | null,
  /** the configuration is unsafe or broken: the app refuses to start and shows this */
  fatal: '',
  /** signed in, but the server could not be reached to load notes */
  connectError: '',
  /** loading notes right after signing in */
  opening: false,
  notebooks: [] as Notebook[],
  /** PDFs the notes refer to (hash -> display name), shared through the library file */
  pdfs: {} as Record<string, { name: string }>,
  pages: [] as Page[],
  nbId: null as string | null,
  pageId: null as string | null,
  editingId: null as string | null,
  caret: null as number | null,
  theme: (ls.get('tb-theme') as Theme) || 'system',
  snap: ls.get('tb-snap') !== '0',
  help: false,
  searchOpen: false,
  searchQuery: '',
  exportOpen: false,
  menu: null as { x: number; y: number; id: string } | null,
  copyAs: (ls.get('tb-copy') === 'text' ? 'text' : 'markdown') as 'markdown' | 'text',
  saveError: null as string | null,
  toasts: [] as Toast[],
});

export const selected = new SvelteSet<string>();

/** Last pointer position over the sheet, used to place pasted content. Not reactive. */
export const pointer = { x: 0, y: 0, valid: false };

let store: PageStore | null = null;
let library: Library = { schema: 1, createdAt: new Date().toISOString() };
const now = () => new Date().toISOString();

// ---------- derived helpers ----------

export const curNb = () => app.notebooks.find((n) => n.id === app.nbId) ?? null;
export const curPage = () => app.pages.find((p) => p.id === app.pageId) ?? null;

export function visiblePages(): Page[] {
  const nb = curNb();
  if (!nb) return [];
  return nb.pageOrder.map((id) => app.pages.find((p) => p.id === id)).filter((p): p is Page => !!p && !p.deleted);
}

export const liveBlocks = (p: Page) => p.blocks.filter((b) => !b.deleted);
export const liveImages = (p: Page) => p.images.filter((i) => !i.deleted);

export function paperOf(p: Page, nb: Notebook) {
  return p.paper === 'default' ? nb.paper : p.paper;
}

// ---------- toasts ----------

let toastSeq = 0;
export function toast(text: string, action?: Toast['action'], ms = 6000) {
  const t: Toast = { id: ++toastSeq, text, action };
  app.toasts.push(t);
  setTimeout(() => dismissToast(t.id), ms);
}
export function dismissToast(id: number) {
  const i = app.toasts.findIndex((t) => t.id === id);
  if (i >= 0) app.toasts.splice(i, 1);
}

// ---------- saving ----------

interface Dirty<T> {
  v: number;
  nb: string;
  item: T;
}
const dirtyPages = new Map<string, Dirty<Page>>();
const dirtyNbs = new Map<string, Dirty<Notebook>>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();

function markPage(page: Page) {
  if (!app.nbId) return;
  const d = dirtyPages.get(page.id);
  dirtyPages.set(page.id, { v: (d?.v ?? 0) + 1, nb: app.nbId, item: page });
  scheduleSave();
}
function markNb(nb: Notebook) {
  const d = dirtyNbs.get(nb.id);
  dirtyNbs.set(nb.id, { v: (d?.v ?? 0) + 1, nb: nb.id, item: nb });
  scheduleSave();
}
/** Debounce saves, but never let continuous activity postpone one for more than MAX_SAVE_WAIT. */
const MAX_SAVE_WAIT = 2000;
let pendingSince = 0;
function scheduleSave(ms = 400) {
  clearTimeout(saveTimer);
  const t = Date.now();
  pendingSince ||= t;
  saveTimer = setTimeout(flush, Math.max(0, Math.min(ms, pendingSince + MAX_SAVE_WAIT - t)));
}

/** Never persist blocks that were opened but left empty. */
function cleanPage(page: Page): Page {
  const snap = $state.snapshot(page) as Page;
  snap.blocks = snap.blocks.filter((b) => b.deleted || b.text !== '');
  return snap;
}

export function flush(): Promise<void> {
  clearTimeout(saveTimer);
  pendingSince = 0;
  chain = chain.then(async () => {
    if (!store) return;
    let error: string | null = null;
    for (const [id, d] of [...dirtyNbs]) {
      try {
        await store.saveNotebook($state.snapshot(d.item) as Notebook);
        if (dirtyNbs.get(id)?.v === d.v) dirtyNbs.delete(id);
      } catch (e) {
        error = String(e);
      }
    }
    for (const [id, d] of [...dirtyPages]) {
      let saved: Page | null = null;
      try {
        saved = cleanPage(d.item);
        const merged = await store.savePage(d.nb, saved);
        if (dirtyPages.get(id)?.v === d.v) dirtyPages.delete(id);
        outbox?.remove(id);
        if (merged) applyMerged(d.nb, merged);
        indexPage(d.nb, merged ?? saved);
      } catch (e) {
        error = String(e);
        // keep the unsent page on this device in case the app is closed before the retry succeeds
        if (saved) outbox?.put(d.nb, saved);
      }
    }
    app.saveError = error;
    if (error) scheduleSave(2000);
  });
  return chain;
}

function touchPage(page: Page) {
  page.updatedAt = now();
  markPage(page);
}
function touchNb(nb: Notebook) {
  nb.updatedAt = now();
  markNb(nb);
}

// ---------- boot ----------

export async function boot() {
  const flushSoon = () => void flush();
  window.addEventListener('blur', flushSoon);
  document.addEventListener('visibilitychange', flushSoon);
  window.addEventListener('beforeunload', flushSoon);
  if (inTauri) {
    try {
      await getCurrentWindow().onCloseRequested(async () => {
        finishEdit();
        await flush();
      });
    } catch {}
  }
  const catchUp = () => void store?.refresh?.().catch(() => {});
  window.addEventListener('online', catchUp);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && catchUp());

  const cfg = readSupabaseConfig(import.meta.env);
  if (cfg.kind === 'invalid') {
    app.fatal = cfg.message; // never fall back silently from an unsafe configuration
  } else if (cfg.kind === 'ok') {
    app.backend = 'supabase';
    await startSupabase(cfg.env).catch((e) => (app.fatal = `Could not start: ${e instanceof Error ? e.message : e}`));
  } else {
    const saved = inTauri ? ls.get('tb-root') : 'browser-demo';
    if (saved) await openRoot(saved).catch((e) => toast(`Could not open notes folder: ${e}`));
  }
  app.loading = false;
}

// ---------- Supabase session ----------

let outbox: Outbox | null = null;
let openUser = '';

async function startSupabase(env: SupabaseEnv) {
  const client = createSupabaseClient(env);
  // supabase-js must not be called from inside this callback, so hand off to the next tick
  client.auth.onAuthStateChange((event, session) => setTimeout(() => void onAuthEvent(event, session), 0));
  const { data } = await client.auth.getSession();
  if (data.session) await openSupabase(data.session.user.id, data.session.user.email ?? '');
}

async function onAuthEvent(event: AuthChangeEvent, session: Session | null) {
  if (event === 'SIGNED_OUT') return void closeSession();
  if (event === 'SIGNED_IN' && session && session.user.id !== openUser) await openSupabase(session.user.id, session.user.email ?? '');
}

async function openSupabase(userId: string, email: string) {
  openUser = userId;
  app.connectError = '';
  app.opening = true;
  try {
    await closeStore();
    outbox = new Outbox(localStorage, `tb-outbox-${userId}`);
    const s = new SupabaseStore(createSupabaseRemote(supabaseClient(), userId));
    await replayOutbox(s);
    await openStore(s, `supabase:${userId}`);
    app.user = email;
  } catch (e) {
    openUser = '';
    app.root = null;
    app.connectError = e instanceof Error ? e.message : String(e);
  } finally {
    app.opening = false;
  }
}

/** Send pages whose save failed in an earlier session. The server merges, so this cannot overwrite newer work. */
async function replayOutbox(s: PageStore) {
  if (!outbox) return;
  let kept = 0;
  for (const e of outbox.list()) {
    try {
      await s.savePage(e.nb, e.page);
      outbox.remove(e.page.id);
    } catch (err) {
      if (/foreign key|invalid/i.test(String(err))) outbox.remove(e.page.id); // its notebook is gone: it can never be sent
      else kept++;
    }
  }
  if (kept) toast(`${kept} unsent ${kept === 1 ? 'change' : 'changes'} from last time will be retried.`);
}

/** Save what we can, then drop every in-memory trace of the open store. */
async function closeStore() {
  finishEdit();
  await flush().catch(() => {});
  clearTimeout(saveTimer);
  await stopWatching?.();
  stopWatching = null;
  store = null;
  dirtyPages.clear();
  dirtyNbs.clear();
  index.clear();
  srcCache.clear();
  histories.clear();
}

/** Signed out (or the session ended): forget the previous user's notes entirely and show the sign-in screen. */
export async function closeSession() {
  await closeStore();
  outbox = null;
  openUser = '';
  Object.assign(app, {
    root: null,
    notebooks: [],
    pages: [],
    nbId: null,
    pageId: null,
    editingId: null,
    view: 'notebooks',
    user: null,
    pdfs: {},
    searchOpen: false,
    menu: null,
    exportOpen: false,
    saveError: null,
    connectError: '',
  });
  selected.clear();
  pdf.open = false;
}

export async function signOut() {
  finishEdit();
  await flush().catch(() => {});
  if (outbox?.list().length) toast('Some changes could not be sent. They stay on this device until you sign in again.');
  // 'local' signs out this device only; other devices stay signed in
  await supabaseClient().auth.signOut({ scope: 'local' }).catch(() => {});
  await closeSession();
}

export async function retryConnect() {
  const { data } = await supabaseClient().auth.getSession();
  if (data.session) await openSupabase(data.session.user.id, data.session.user.email ?? '');
  else await closeSession();
}

export async function pickFolder() {
  const dir = await open({ directory: true, multiple: false, title: 'Choose your notes folder' });
  if (typeof dir === 'string') {
    try {
      await openRoot(dir);
    } catch (e) {
      toast(`Could not open that folder: ${e}`);
    }
  }
}

async function openRoot(path: string) {
  await openStore(inTauri ? new FsPageStore(path) : new MemoryStore(), path);
  if (inTauri) ls.set('tb-root', path);
}

async function openStore(s: PageStore, label: string) {
  await flush();
  await stopWatching?.();
  stopWatching = null;
  index.clear();
  await s.init();
  store = s;
  app.root = label;
  library = await s.loadLibrary();
  app.pdfs = { ...(library.pdfs ?? {}) };
  app.notebooks = (await s.listNotebooks()).filter((n) => !n.deleted).sort((a, b) => a.name.localeCompare(b.name));
  if (!app.notebooks.length) await createNotebook('My Notebook', false);
  clearOpenNotebook(); // start on the notebook list; the user picks what to open
  stopWatching = (await s.watch?.(applyExternal).catch(() => null)) ?? null;
  void buildIndex();
}

let stopWatching: (() => void | Promise<void>) | null = null;

export async function changeFolder() {
  await flush();
  await pickFolder();
}

// ---------- sync: external changes, search index ----------

const MERGED_TEXT = 'Merged changes from another device';
const toastMerged = () => {
  if (!app.toasts.some((t) => t.text === MERGED_TEXT)) toast(MERGED_TEXT);
};

/** Keep pageOrder in step with the page files that exist (pages can arrive or vanish via sync). */
function reconcileOrder(nb: Notebook) {
  const live = app.pages.filter((p) => !p.deleted);
  const known = nb.pageOrder.filter((pid, i) => live.some((p) => p.id === pid) && nb.pageOrder.indexOf(pid) === i);
  const extra = live
    .filter((p) => !known.includes(p.id))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((p) => p.id);
  if (extra.length || known.length !== nb.pageOrder.length) {
    nb.pageOrder = [...known, ...extra];
    markNb(nb);
  }
}

/** Replace a page's contents with a merged version, keeping an empty block that is being typed into. */
function applyRemote(p: Page, merged: Page) {
  // The server empties deleted pages. Keep our copy of the content so Undo can still bring the page back.
  if (merged.deleted) {
    Object.assign(p, merged, { title: p.title, tags: p.tags, blocks: p.blocks, images: p.images });
    return;
  }
  const keep = p.blocks.filter((b) => b.text === '' && !b.deleted && !merged.blocks.some((m) => m.id === b.id));
  Object.assign(p, merged, { blocks: [...merged.blocks, ...keep] });
  p.images ??= [];
  if (app.editingId && !p.blocks.some((b) => b.id === app.editingId && !b.deleted)) app.editingId = null;
  for (const id of [...selected]) {
    if (!p.blocks.some((b) => b.id === id && !b.deleted) && !p.images.some((i) => i.id === id && !i.deleted))
      selected.delete(id);
  }
}

/** The store merged in changes from disk while saving; show them. */
function applyMerged(nbId: string, merged: Page) {
  if (nbId !== app.nbId) return;
  const p = app.pages.find((p) => p.id === merged.id);
  if (!p) return;
  const before = $state.snapshot(p) as Page;
  applyRemote(p, merged);
  if (differs(scrubPage($state.snapshot(p) as Page), scrubPage(before))) toastMerged();
}

function applyExternal(c: ExternalChange) {
  if (c.type === 'notebook') return applyExternalNotebook(c);
  if (c.nbId !== app.nbId) {
    indexPage(c.nbId, c.page);
    if (c.conflict) toastMerged();
    return;
  }
  const nb = curNb();
  const existing = app.pages.find((p) => p.id === c.page.id);
  if (!existing) {
    if (c.page.deleted) return;
    app.pages.push({ ...c.page, images: c.page.images ?? [] });
    if (nb) reconcileOrder(nb);
    indexPage(c.nbId, c.page);
    toastMerged();
    return;
  }
  const local = $state.snapshot(existing) as Page;
  const merged = mergePages(local, { ...c.page, images: c.page.images ?? [] });
  indexPage(c.nbId, merged);
  // compare as the server would keep them (it empties deleted content), or every delete would look like news
  if (differs(scrubPage(merged), scrubPage(c.page))) markPage(existing); // the stored copy is behind: write back
  if (!differs(scrubPage(merged), scrubPage(local))) return;
  applyRemote(existing, merged);
  if (nb) reconcileOrder(nb);
  if (existing.deleted && app.pageId === existing.id) {
    const next = visiblePages()[0];
    if (next) selectPage(next.id);
    else createPage();
  }
  toastMerged();
}

function applyExternalNotebook(c: Extract<ExternalChange, { type: 'notebook' }>) {
  const incoming = c.notebook;
  const nb = app.notebooks.find((n) => n.id === incoming.id);
  if (!nb) {
    if (!incoming.deleted) app.notebooks.push(incoming);
    return;
  }
  const local = $state.snapshot(nb) as Notebook;
  const merged = mergeNotebooks(local, incoming);
  if (differs(scrubNotebook(merged), scrubNotebook(incoming))) markNb(nb);
  if (!differs(scrubNotebook(merged), scrubNotebook(local))) return;
  // keep our own name and page order for a deleted notebook so Undo can restore them
  Object.assign(nb, merged, merged.deleted ? { name: nb.name, pageOrder: nb.pageOrder } : {});
  if (nb.deleted) {
    app.notebooks.splice(app.notebooks.indexOf(nb), 1);
    if (app.nbId === nb.id) clearOpenNotebook();
  } else if (app.nbId === nb.id) reconcileOrder(nb);
  if (c.conflict) toastMerged();
}

const index = new Map<string, IndexEntry>();

export function indexPage(nbId: string, page: Page) {
  if (page.deleted) index.delete(page.id);
  else index.set(page.id, entryOf(nbId, app.notebooks.find((n) => n.id === nbId)?.name ?? '', page));
}

/** In-memory search index, rebuilt from the page files on startup (never stored in the synced folder). */
async function buildIndex() {
  const s = store;
  if (!s) return;
  let merged = 0;
  for (const nb of [...app.notebooks]) {
    try {
      merged += await s.resolveConflicts(nb.id);
      for (const page of await s.listPages(nb.id)) {
        // keep in-memory (possibly unsaved) pages of the open notebook authoritative
        if (nb.id === app.nbId && app.pages.some((p) => p.id === page.id)) continue;
        indexPage(nb.id, { ...page, images: page.images ?? [] });
      }
    } catch {
      /* an unreadable notebook should not break search for the rest */
    }
    if (s !== store) return;
  }
  for (const p of app.pages) if (app.nbId) indexPage(app.nbId, $state.snapshot(p) as Page);
  if (merged) toastMerged();
}

export const searchIndex = () => index.values();

/** Remember a PDF's display name in the synced library (never its path: that differs per device). */
export async function registerPdf(hash: string, name: string) {
  if (!store || app.pdfs[hash]?.name === name) return;
  app.pdfs[hash] = { name };
  try {
    library = await store.saveLibrary({ ...library, pdfs: { ...(library.pdfs ?? {}), [hash]: { name } } });
    app.pdfs = { ...(library.pdfs ?? {}) };
  } catch (e) {
    toast(`Could not save the PDF list: ${e}`);
  }
}

/** Open a search result: switch notebook if needed, then page. */
export async function openPage(nbId: string, pageId: string) {
  if (nbId !== app.nbId) {
    ls.set('tb-page-' + nbId, pageId);
    await selectNotebook(nbId);
  }
  app.view = 'pages';
  if (visiblePages().some((p) => p.id === pageId)) selectPage(pageId);
}

// ---------- notebooks ----------

export async function selectNotebook(id: string) {
  finishEdit();
  await flush();
  const nb = app.notebooks.find((n) => n.id === id);
  if (!nb || !store) return;
  app.nbId = id;
  app.view = 'pages';
  selected.clear();
  if (app.root) ls.set('tb-nb-' + app.root, id);
  if ((await store.resolveConflicts(id)) > 0) toastMerged();
  app.pages = (await store.listPages(id)).map((p) => ({ ...p, images: p.images ?? [] }));
  reconcileOrder(nb);
  const last = ls.get('tb-page-' + id);
  if (nb.pageOrder.length === 0) createPage();
  else app.pageId = nb.pageOrder.includes(last ?? '') ? last! : nb.pageOrder[0];
}

/** Close whatever notebook is open and return to the notebook list. */
function clearOpenNotebook() {
  app.nbId = null;
  app.pageId = null;
  app.pages = [];
  app.editingId = null;
  selected.clear();
  app.view = 'notebooks';
}

/** Back to the list of notebooks (the open notebook stays loaded and highlighted). */
export async function showNotebooks() {
  finishEdit();
  await flush();
  app.view = 'notebooks';
}

export async function createNotebook(name: string, open = true) {
  const nb: Notebook = {
    schema: 1,
    id: newNotebookId(),
    name: name.trim() || 'Untitled notebook',
    paper: 'ruled',
    font: 'caveat',
    fontSize: 24,
    ink: 'blue',
    margin: true,
    pageOrder: [],
    updatedAt: now(),
  };
  try {
    await store?.saveNotebook(nb);
  } catch (e) {
    return void toast(`Could not create the notebook: ${e instanceof Error ? e.message : e}`);
  }
  app.notebooks.push(nb);
  if (open) await selectNotebook(nb.id);
}

export function updateNotebook(patch: Partial<Notebook>) {
  const nb = curNb();
  if (!nb) return;
  Object.assign(nb, patch);
  touchNb(nb);
}

export function renameNotebook(id: string, name: string) {
  const nb = app.notebooks.find((n) => n.id === id);
  if (nb && name.trim()) {
    nb.name = name.trim();
    touchNb(nb);
  }
}

export async function deleteNotebook(id: string) {
  const nb = app.notebooks.find((n) => n.id === id);
  if (!nb) return;
  finishEdit();
  await flush();
  // The server empties every page of a deleted notebook, so keep our copies in memory in case of Undo.
  let pages: Page[] = [];
  if (app.backend === 'supabase' && store) {
    try {
      pages = id === app.nbId ? ($state.snapshot(app.pages) as Page[]) : await store.listPages(id);
    } catch {
      /* without them Undo restores the notebook but not its pages; deleting must still work */
    }
  }
  nb.deleted = true;
  touchNb(nb);
  await flush();
  const i = app.notebooks.indexOf(nb);
  app.notebooks.splice(i, 1);
  toast(`Notebook “${nb.name}” deleted`, {
    label: 'Undo',
    run: async () => {
      nb.deleted = false;
      touchNb(nb);
      app.notebooks.splice(Math.min(i, app.notebooks.length), 0, nb);
      await flush();
      // bring the emptied pages back: a newer updatedAt makes them win over the server's empty copies
      for (const p of pages.filter((p) => !p.deleted)) {
        await store?.savePage(id, { ...p, updatedAt: now() }).catch(() => {});
      }
    },
  });
  if (app.nbId === id) clearOpenNotebook();
}

// ---------- pages ----------

export function selectPage(id: string) {
  finishEdit();
  selected.clear();
  app.view = 'pages';
  app.pageId = id;
  if (app.nbId) ls.set('tb-page-' + app.nbId, id);
}

export function createPage() {
  const nb = curNb();
  if (!nb) return;
  finishEdit();
  const page: Page = {
    schema: 1,
    id: newPageId(),
    title: '',
    paper: 'default',
    tags: [],
    updatedAt: now(),
    blocks: [],
    images: [],
  };
  app.pages.push(page);
  const at = nb.pageOrder.indexOf(app.pageId ?? '');
  nb.pageOrder.splice(at < 0 ? nb.pageOrder.length : at + 1, 0, page.id);
  touchNb(nb);
  markPage(app.pages[app.pages.length - 1]);
  selectPage(page.id);
}

export function renamePage(id: string, title: string) {
  const p = app.pages.find((p) => p.id === id);
  if (p && p.title !== title) {
    p.title = title;
    touchPage(p);
  }
}

export function setPagePaper(paper: Page['paper']) {
  const p = curPage();
  if (p) {
    p.paper = paper;
    touchPage(p);
  }
}

export function duplicatePage(id: string) {
  const nb = curNb();
  const src = app.pages.find((p) => p.id === id);
  if (!nb || !src) return;
  const copy = $state.snapshot(src) as Page;
  copy.id = newPageId();
  copy.title = src.title ? src.title + ' (copy)' : '';
  copy.updatedAt = now();
  copy.blocks = copy.blocks.filter((b) => !b.deleted).map((b) => ({ ...b, id: newBlockId() }));
  app.pages.push(copy);
  nb.pageOrder.splice(nb.pageOrder.indexOf(id) + 1, 0, copy.id);
  touchNb(nb);
  markPage(app.pages[app.pages.length - 1]);
  selectPage(copy.id);
}

export function deletePage(id: string) {
  const nb = curNb();
  const p = app.pages.find((p) => p.id === id);
  if (!nb || !p) return;
  finishEdit();
  const idx = nb.pageOrder.indexOf(id);
  p.deleted = true;
  touchPage(p);
  nb.pageOrder.splice(idx, 1);
  touchNb(nb);
  if (app.pageId === id) {
    if (nb.pageOrder.length) selectPage(nb.pageOrder[Math.min(idx, nb.pageOrder.length - 1)]);
    else createPage();
  }
  toast(`Page${p.title ? ` “${p.title}”` : ''} deleted`, {
    label: 'Undo',
    run: () => {
      p.deleted = false;
      touchPage(p);
      nb.pageOrder.splice(Math.min(idx, nb.pageOrder.length), 0, id);
      touchNb(nb);
      selectPage(id);
    },
  });
}

export function movePage(id: string, toIndex: number) {
  const nb = curNb();
  if (!nb) return;
  const from = nb.pageOrder.indexOf(id);
  if (from < 0) return;
  nb.pageOrder.splice(from, 1);
  nb.pageOrder.splice(Math.max(0, Math.min(toIndex, nb.pageOrder.length)), 0, id);
  touchNb(nb);
}

export function stepPage(delta: number) {
  const nb = curNb();
  if (!nb || !app.pageId) return;
  const i = nb.pageOrder.indexOf(app.pageId) + delta;
  if (i >= 0 && i < nb.pageOrder.length) selectPage(nb.pageOrder[i]);
}

// ---------- undo / edit sessions ----------

const histories = new Map<string, History>();
const hist = (id: string) => {
  let h = histories.get(id);
  if (!h) histories.set(id, (h = new History()));
  return h;
};

let session: { pageId: string; before: Snapshot } | null = null;
const newIds = new Set<string>();

/** Start grouping changes into a single undo step. */
export function begin() {
  const p = curPage();
  if (p && !session) session = { pageId: p.id, before: snapshotOf(p) };
}

/** Close the undo step, recording it only if something actually changed. */
export function commit() {
  const s = session;
  session = null;
  if (!s) return;
  const p = app.pages.find((p) => p.id === s.pageId);
  if (p && !sameSnapshot(s.before, snapshotOf(p))) hist(p.id).push(s.before);
}

function applySnapshot(p: Page, snap: Snapshot) {
  const t = now();
  p.blocks = restoreBlocks($state.snapshot(p.blocks) as Block[], snap.blocks, t);
  p.images = restoreBlocks($state.snapshot(p.images) as ImageItem[], snap.images, t);
  p.tags = snap.tags;
  p.title = snap.title;
  p.paper = snap.paper as Page['paper'];
  selected.clear();
  touchPage(p);
}

export function undo() {
  finishEdit();
  const p = curPage();
  const snap = p && hist(p.id).undo(snapshotOf(p));
  if (p && snap) applySnapshot(p, snap);
}

export function redo() {
  finishEdit();
  const p = curPage();
  const snap = p && hist(p.id).redo(snapshotOf(p));
  if (p && snap) applySnapshot(p, snap);
}

// ---------- blocks ----------

export function createBlockAt(x: number, y: number) {
  const p = curPage();
  const nb = curNb();
  if (!p || !nb) return;
  finishEdit();
  begin();
  const b: Block = {
    id: newBlockId(),
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    text: '',
    style: 'normal',
    ink: nb.ink,
    ...(pdf.autoLink ? refField() : {}),
    updatedAt: now(),
    deleted: false,
  };
  p.blocks.push(b);
  newIds.add(b.id);
  selected.clear();
  app.caret = null;
  app.editingId = b.id;
}

export function beginEdit(id: string, caret: number | null = null) {
  if (app.editingId === id) return;
  finishEdit();
  begin();
  selected.clear();
  app.caret = caret;
  app.editingId = id;
}

export function setBlockText(b: Block, text: string) {
  b.text = text;
  b.updatedAt = now();
  const p = curPage();
  if (p) touchPage(p);
}

export function finishEdit() {
  const id = app.editingId;
  if (!id) return;
  app.editingId = null;
  app.caret = null;
  const p = curPage();
  const b = p?.blocks.find((b) => b.id === id);
  if (p && b) {
    const trimmed = b.text.replace(/\s+$/, '');
    if (trimmed !== b.text) setBlockText(b, trimmed);
    if (b.text === '') {
      if (newIds.has(id)) p.blocks.splice(p.blocks.indexOf(b), 1);
      else {
        b.deleted = true;
        b.updatedAt = now();
      }
      touchPage(p);
    }
  }
  newIds.delete(id);
  commit();
}

export function moveBlocks(ids: Iterable<string>, dx: number, dy: number) {
  const p = curPage();
  if (!p) return;
  const set = new Set(ids);
  const t = now();
  for (const b of [...p.blocks, ...p.images]) {
    if (!set.has(b.id) || b.deleted) continue;
    b.x = Math.max(0, Math.min(PAGE_W - 40, b.x + dx));
    b.y = Math.max(0, b.y + dy);
    b.updatedAt = t;
  }
  touchPage(p);
}

export function nudge(dx: number, dy: number) {
  if (!selected.size) return;
  begin();
  moveBlocks(selected, dx, dy);
  commit();
}

export function deleteSelected() {
  const p = curPage();
  if (!p || !selected.size) return;
  begin();
  const t = now();
  for (const b of [...p.blocks, ...p.images]) {
    if (selected.has(b.id)) {
      b.deleted = true;
      b.updatedAt = t;
    }
  }
  selected.clear();
  touchPage(p);
  commit();
}

export function setInk(ink: Ink) {
  const p = curPage();
  const nb = curNb();
  if (!nb) return;
  updateNotebook({ ink });
  const targets = new Set(selected);
  if (app.editingId) targets.add(app.editingId);
  if (!p || !targets.size) return;
  const wasEditing = !!app.editingId;
  if (!wasEditing) begin();
  const t = now();
  for (const b of p.blocks) {
    if (targets.has(b.id)) {
      b.ink = ink;
      b.updatedAt = t;
    }
  }
  touchPage(p);
  if (!wasEditing) commit();
}

export function setTheme(t: Theme) {
  app.theme = t;
  ls.set('tb-theme', t);
}
export function toggleSnap() {
  app.snap = !app.snap;
  ls.set('tb-snap', app.snap ? '1' : '0');
}

export function selectAll() {
  const p = curPage();
  if (!p) return;
  for (const b of liveBlocks(p)) selected.add(b.id);
  for (const i of liveImages(p)) selected.add(i.id);
}

// ---------- block styles ----------

/** Apply a style to the given block ids (or the editing block / selection when omitted). */
export function setStyle(style: BlockStyle, ids?: Iterable<string>) {
  const p = curPage();
  if (!p) return;
  const targets = new Set(ids ?? (selected.size ? selected : app.editingId ? [app.editingId] : []));
  if (!targets.size) return;
  const wasEditing = !!app.editingId;
  if (!wasEditing) begin();
  const t = now();
  for (const b of p.blocks) {
    if (targets.has(b.id) && !b.deleted && b.style !== style) {
      b.style = style;
      b.updatedAt = t;
    }
  }
  touchPage(p);
  if (!wasEditing) commit();
}

// ---------- images ----------

const srcCache = new Map<string, Promise<string>>();

/** Data URL for an image asset, loaded once. */
export function imageSrc(nbId: string, asset: string): Promise<string> {
  const key = nbId + '/' + asset;
  let src = srcCache.get(key);
  if (!src) {
    src = store ? store.readAsset(nbId, asset) : Promise.reject(new Error('no store'));
    src.catch(() => srcCache.delete(key));
    srcCache.set(key, src);
  }
  return src;
}

export const IMAGE_WIDTH: Record<ImageSize, number> = { s: 200, m: 400, l: 700 };

/** Store pasted image bytes as a notebook asset and place it on the page. */
export async function addImage(base64: string, ext: string, at?: { x: number; y: number }) {
  const p = curPage();
  const nb = curNb();
  if (!p || !nb || !store) return;
  finishEdit();
  const asset = newAssetName(ext);
  try {
    await store.writeAsset(nb.id, asset, base64);
  } catch (e) {
    toast(`Could not save the image: ${e}`);
    return;
  }
  srcCache.set(nb.id + '/' + asset, Promise.resolve(`data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`));
  begin();
  const pos = at ?? pastePosition();
  const item: ImageItem = {
    id: newImageId(),
    x: Math.max(0, Math.round(pos.x)),
    y: Math.max(0, Math.round(pos.y)),
    size: 'm',
    asset,
    updatedAt: now(),
    deleted: false,
  };
  p.images.push(item);
  touchPage(p);
  commit();
  selected.clear();
  selected.add(item.id);
}

export function setImageSize(id: string, size: ImageSize) {
  const p = curPage();
  const img = p?.images.find((i) => i.id === id);
  if (!p || !img || img.size === size) return;
  begin();
  img.size = size;
  img.updatedAt = now();
  touchPage(p);
  commit();
}

/** Move a point down until it is not on top of an existing block or image. */
function clearOfItems(x: number, y: number, L: number) {
  const rects = [...document.querySelectorAll<HTMLElement>('.desk [data-item]')].map((el) => ({
    l: el.offsetLeft,
    t: el.offsetTop,
    r: el.offsetLeft + el.offsetWidth,
    b: el.offsetTop + el.offsetHeight,
  }));
  for (let i = 0; i < 50; i++) {
    const hit = rects.find((r) => x >= r.l - 4 && x <= r.r && y >= r.t - 4 && y <= r.b);
    if (!hit) break;
    y = TOP + Math.ceil((hit.b + 4 - TOP) / L) * L;
  }
  return { x, y };
}

/** Where pasted content lands: at the pointer if it has been over the sheet, else below everything. */
export function pastePosition(): { x: number; y: number } {
  const nb = curNb();
  const p = curPage();
  if (!nb || !p) return { x: MARGIN_X + 12, y: TOP };
  const L = lineHeightOf(nb);
  if (pointer.valid) return clearOfItems(pointer.x, TOP + Math.floor((pointer.y - TOP) / L) * L, L);
  const bottom = Math.max(
    TOP - L,
    ...liveBlocks(p).map((b) => b.y + L * Math.max(1, b.text.split('\n').length)),
    ...liveImages(p).map((i) => i.y + 300),
  );
  return { x: MARGIN_X + 12, y: bottom + L };
}

/** Create a block holding pasted text. */
export function addTextBlock(text: string, style: BlockStyle = 'normal', ref?: PdfRef) {
  const p = curPage();
  const nb = curNb();
  if (!p || !nb || !text.trim()) return;
  finishEdit();
  begin();
  const pos = pastePosition();
  const b: Block = {
    id: newBlockId(),
    x: Math.max(0, Math.round(pos.x)),
    y: Math.max(0, Math.round(pos.y)),
    text: text.replace(/\r\n?/g, '\n').replace(/\s+$/, ''),
    style,
    ink: nb.ink,
    ...(ref ? { ref } : pdf.autoLink ? refField() : {}),
    updatedAt: now(),
    deleted: false,
  };
  p.blocks.push(b);
  touchPage(p);
  commit();
  selected.clear();
  selected.add(b.id);
}

// ---------- tags ----------

export function addTag(raw: string) {
  const p = curPage();
  const tag = raw.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-');
  if (!p || !tag || p.tags.includes(tag)) return;
  begin();
  p.tags.push(tag);
  touchPage(p);
  commit();
}

export function removeTag(tag: string) {
  const p = curPage();
  if (!p || !p.tags.includes(tag)) return;
  begin();
  p.tags = p.tags.filter((t) => t !== tag);
  touchPage(p);
  commit();
}

// ---------- menus & settings ----------

export function openMenu(x: number, y: number, id: string) {
  app.menu = { x, y, id };
}
export function closeMenu() {
  app.menu = null;
}
export function setCopyAs(mode: 'markdown' | 'text') {
  app.copyAs = mode;
  ls.set('tb-copy', mode);
}
export function openSearch(query = '') {
  app.searchQuery = query;
  app.searchOpen = true;
}

// ---------- PDF links ----------

/** `{ ref }` for the PDF page currently shown, or nothing. */
function refField(): { ref?: PdfRef } {
  const ref = pdfRef();
  return ref ? { ref } : {};
}

function linkTargets(ids?: Iterable<string>) {
  return new Set(ids ?? (selected.size ? selected : app.editingId ? [app.editingId] : []));
}

/** Point the given blocks (default: selection or the block being edited) at the PDF page now showing. */
export function linkToPdfPage(ids?: Iterable<string>) {
  const p = curPage();
  const ref = pdfRef();
  if (!p) return;
  if (!ref) return toast('Open a PDF first');
  const targets = linkTargets(ids);
  if (!targets.size) return toast('Select a block to link');
  const wasEditing = !!app.editingId;
  if (!wasEditing) begin();
  const t = now();
  for (const b of p.blocks) {
    if (targets.has(b.id) && !b.deleted) {
      b.ref = { ...ref };
      b.updatedAt = t;
    }
  }
  touchPage(p);
  if (!wasEditing) commit();
}

export function unlinkPdf(ids?: Iterable<string>) {
  const p = curPage();
  if (!p) return;
  const targets = linkTargets(ids);
  const wasEditing = !!app.editingId;
  if (!wasEditing) begin();
  const t = now();
  for (const b of p.blocks) {
    if (targets.has(b.id) && b.ref) {
      delete b.ref;
      b.updatedAt = t;
    }
  }
  touchPage(p);
  if (!wasEditing) commit();
}
