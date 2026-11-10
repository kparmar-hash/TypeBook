import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { app, registerPdf, toast } from './app.svelte';
import { inTauri } from './files';
import { pdf } from './pdfState.svelte';
import { baseName, findMatches, pageText, quoteFromPdf, sameText, sha256Hex, type Match } from './pdfText';
import type { PdfRef } from './types';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

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

const asset = (p: string) => `${import.meta.env.BASE_URL}pdfjs/${p}`;

let lib: Promise<PdfJs> | null = null;
/** pdf.js is large, so it is only loaded when a PDF is first opened. */
function loadLib(): Promise<PdfJs> {
  return (lib ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })());
}

let doc: PDFDocumentProxy | null = null;
let docTask: PDFDocumentLoadingTask | null = null;

// ---------- per-device paths ----------
// The synced library only knows hash + display name; where the file lives is a property of this machine.

const PATHS_KEY = 'tb-pdf-paths';
const readPaths = (): Record<string, string> => {
  try {
    return JSON.parse(ls.get(PATHS_KEY) ?? '{}');
  } catch {
    return {};
  }
};
const rememberPath = (hash: string, path: string) => ls.set(PATHS_KEY, JSON.stringify({ ...readPaths(), [hash]: path }));
const forgetPath = (hash: string) => {
  const p = readPaths();
  delete p[hash];
  ls.set(PATHS_KEY, JSON.stringify(p));
};
export const pdfPathFor = (hash: string) => readPaths()[hash];

// ---------- opening ----------

interface Picked {
  bytes: Uint8Array;
  name: string;
  path?: string;
}

async function readPath(path: string): Promise<Picked> {
  const buf = await invoke<ArrayBuffer>('read_file_bytes', { path });
  return { bytes: new Uint8Array(buf), name: baseName(path), path };
}

async function pickPdf(title: string): Promise<Picked | null> {
  if (inTauri) {
    const path = await openDialog({ multiple: false, title, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    return typeof path === 'string' ? readPath(path) : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function load(p: Picked) {
  pdf.loading = true;
  pdf.error = '';
  try {
    const pdfjs = await loadLib();
    const hash = (await sha256Hex(p.bytes)).slice(0, 32);
    const task = pdfjs.getDocument({
      data: p.bytes,
      cMapUrl: asset('cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: asset('standard_fonts/'),
      wasmUrl: asset('wasm/'),
    });
    const next = await task.promise;
    await docTask?.destroy();
    docTask = task;
    doc = next;
    texts = null;
    searchToken++;
    pdf.hash = hash;
    pdf.name = p.name;
    pdf.numPages = next.numPages;
    pdf.page = Math.min(Math.max(1, Number(ls.get('tb-pdf-page-' + hash)) || 1), next.numPages);
    pdf.query = '';
    pdf.matchCount = 0;
    pdf.matchIdx = -1;
    pdf.open = true;
    if (p.path) rememberPath(hash, p.path);
    void registerPdf(hash, app.pdfs[hash]?.name ?? p.name);
    saveLast();
    return hash;
  } catch (e) {
    pdf.error = e instanceof Error ? e.message : String(e);
    toast(`Could not open the PDF: ${pdf.error}`);
    return null;
  } finally {
    pdf.loading = false;
  }
}

function saveLast() {
  ls.set('tb-pdf-last', JSON.stringify({ hash: pdf.hash, open: pdf.open }));
  if (pdf.hash) ls.set('tb-pdf-page-' + pdf.hash, String(pdf.page));
}

/** Choose a PDF from disk and show it in the side pane. */
export async function openPdfPicker() {
  const picked = await pickPdf('Open a PDF').catch((e) => (toast(`Could not read the file: ${e}`), null));
  if (picked) await load(picked);
}

/** Bring a previous session's PDF back, if this machine still knows where it is. */
export async function restoreLastPdf() {
  try {
    const last = JSON.parse(ls.get('tb-pdf-last') ?? 'null') as { hash: string; open: boolean } | null;
    const path = last && pdfPathFor(last.hash);
    if (!last || !last.open || !path || !inTauri) return;
    await load(await readPath(path));
  } catch {
    /* file moved or gone: stay closed */
  }
}

export function togglePdfPane() {
  if (!pdf.hash) return void openPdfPicker();
  pdf.open = !pdf.open;
  saveLast();
}

export async function closePdf() {
  pdf.open = false;
  saveLast();
}

/** Open the PDF a block refers to at its page, asking where the file is if this device does not know. */
export async function openRef(ref: PdfRef) {
  if (pdf.hash !== ref.pdf) {
    const name = app.pdfs[ref.pdf]?.name ?? 'the PDF';
    const path = pdfPathFor(ref.pdf);
    let ok = false;
    if (path) {
      try {
        ok = (await load(await readPath(path))) === ref.pdf;
      } catch {
        forgetPath(ref.pdf);
      }
    }
    if (!ok) {
      toast(`Choose “${name}” to open this reference`, undefined, 4000);
      const picked = await pickPdf(`Locate ${name}`).catch(() => null);
      if (!picked) return;
      const hash = await load(picked);
      if (hash !== ref.pdf) return void toast('That is a different file from the one this note refers to');
    }
  }
  pdf.open = true;
  goToPage(ref.page);
}

// ---------- navigation ----------

export function goToPage(n: number) {
  if (!pdf.numPages) return;
  pdf.page = Math.min(Math.max(1, Math.round(n) || 1), pdf.numPages);
  saveLast();
}
export const nextPage = () => goToPage(pdf.page + 1);
export const prevPage = () => goToPage(pdf.page - 1);

export function setZoom(z: number) {
  pdf.zoom = z === 0 ? 0 : Math.min(4, Math.max(0.3, z));
}
export function zoomBy(factor: number) {
  setZoom((pdf.zoom || pdf.scale) * factor);
}

// ---------- rendering ----------

let renderId = 0;
let renderTask: RenderTask | null = null;
let textLayer: TextLayer | null = null;
let textDiv: HTMLElement | null = null;

/** Draw the current page into `canvas`, with a selectable text layer on top. */
export async function renderCurrent(canvas: HTMLCanvasElement, text: HTMLElement, availableWidth: number) {
  if (!doc) return;
  const id = ++renderId;
  renderTask?.cancel();
  textLayer?.cancel();
  const page = await doc.getPage(pdf.page);
  if (id !== renderId) return;
  const base = page.getViewport({ scale: 1 });
  const scale = pdf.zoom > 0 ? pdf.zoom : Math.max(0.3, (availableWidth - 24) / base.width);
  pdf.scale = scale;
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  text.replaceChildren();
  text.style.width = viewport.width + 'px';
  text.style.height = viewport.height + 'px';
  text.style.setProperty('--total-scale-factor', String(scale));
  text.style.setProperty('--scale-factor', String(scale));
  textDiv = text;
  try {
    renderTask = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    await renderTask.promise;
    if (id !== renderId) return;
    textLayer = new (await loadLib()).TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
    await textLayer.render();
    if (id === renderId) highlightHits();
  } catch (e) {
    if ((e as { name?: string }).name === 'RenderingCancelledException' || id !== renderId) return;
    pdf.error = e instanceof Error ? e.message : String(e);
  }
}

// ---------- search ----------

let texts: string[] | null = null;
let matches: Match[] = [];
let searchToken = 0;

async function ensureTexts(token: number): Promise<string[] | null> {
  if (texts) return texts;
  if (!doc) return null;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (token !== searchToken) return null;
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(pageText(content.items.filter((it): it is Extract<typeof it, { str: string }> => 'str' in it)));
    if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return (texts = out);
}

function highlightHits() {
  if (!textDiv) return;
  const q = pdf.query.trim().toLowerCase();
  for (const span of textDiv.querySelectorAll<HTMLElement>('span')) {
    span.classList.toggle('hit', !!q && (span.textContent ?? '').toLowerCase().includes(q));
  }
}

/** Search the whole document; jumps to the first match at or after the current page. */
export async function searchPdf(query: string) {
  const token = ++searchToken;
  pdf.query = query;
  matches = [];
  pdf.matchCount = 0;
  pdf.matchIdx = -1;
  if (!query.trim()) return highlightHits();
  pdf.searching = true;
  const all = await ensureTexts(token);
  if (token !== searchToken || !all) return;
  pdf.searching = false;
  matches = findMatches(all, query);
  pdf.matchCount = matches.length;
  if (!matches.length) return highlightHits();
  const first = matches.findIndex((m) => m.page >= pdf.page);
  jumpToMatch(first < 0 ? 0 : first);
}

function jumpToMatch(i: number) {
  pdf.matchIdx = i;
  const same = matches[i].page === pdf.page;
  goToPage(matches[i].page);
  if (same) highlightHits();
}

export function stepMatch(delta: 1 | -1) {
  if (!matches.length) return;
  jumpToMatch((pdf.matchIdx + delta + matches.length) % matches.length);
}

// ---------- copying text out of the PDF ----------

let lastCopy: { text: string; ref: PdfRef } | null = null;

/** Remember what was just copied from the PDF text layer, so pasting it into a page can cite the source. */
export function recordPdfCopy() {
  const text = window.getSelection()?.toString() ?? '';
  lastCopy = text.trim() && pdf.hash ? { text, ref: { pdf: pdf.hash, page: pdf.page } } : null;
}

/** If `pasted` is what was last copied from the PDF, return it as a clean quote with its source. */
export function matchPdfCopy(pasted: string): { text: string; ref: PdfRef } | null {
  if (!lastCopy || !sameText(lastCopy.text, pasted)) return null;
  return { text: quoteFromPdf(lastCopy.text), ref: lastCopy.ref };
}
