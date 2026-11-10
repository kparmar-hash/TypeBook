import { readImage, readText, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  addImage,
  addTextBlock,
  app,
  curNb,
  curPage,
  imageSrc,
  lineHeightOf,
  paperOf,
  selected,
  toast,
  visiblePages,
} from './app.svelte';
import { blocksToMarkdown, blocksToPlainText, pageToMarkdown, slug, type ExportOptions } from './exportMd';
import { matchPdfCopy } from './pdfDoc';
import { canvasToBlob, renderPage } from './render';
import { buildPdf } from './pdf';
import { chooseFolder, dirname, fromBase64, inTauri, saveAs, toBase64, writeFileAt } from './files';
import type { Page } from './types';

const exportOpts = (): ExportOptions => ({ pdfName: (h) => app.pdfs[h]?.name });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- clipboard ----------

async function writeClipboardText(text: string) {
  if (inTauri) await writeText(text);
  else await navigator.clipboard.writeText(text);
}

async function writeClipboardPng(blob: Blob) {
  if (inTauri) await writeImage(new Uint8Array(await blob.arrayBuffer()));
  else await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

function selection() {
  const p = curPage();
  if (!p) return null;
  return {
    page: p,
    blocks: p.blocks.filter((b) => selected.has(b.id) && !b.deleted),
    images: p.images.filter((i) => selected.has(i.id) && !i.deleted),
  };
}

/** Copy the selected blocks as Markdown, plain text or a PNG of just the selection. */
export async function copySelection(mode: 'markdown' | 'text' | 'image') {
  const sel = selection();
  const nb = curNb();
  if (!sel || !nb || (!sel.blocks.length && !sel.images.length)) return toast('Select some blocks first');
  const L = lineHeightOf(nb);
  try {
    if (mode === 'markdown') await writeClipboardText(blocksToMarkdown(sel.blocks, sel.images, L, exportOpts()));
    else if (mode === 'text') await writeClipboardText(blocksToPlainText(sel.blocks, sel.images, L, exportOpts()));
    else {
      // bounding box of the selected items as laid out on screen
      let x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0;
      for (const id of selected) {
        const el = document.querySelector<HTMLElement>(`.desk [data-item][data-id="${id}"]`);
        if (!el) continue;
        x0 = Math.min(x0, el.offsetLeft);
        y0 = Math.min(y0, el.offsetTop);
        x1 = Math.max(x1, el.offsetLeft + el.offsetWidth);
        y1 = Math.max(y1, el.offsetTop + el.offsetHeight);
      }
      const pad = 16;
      x0 = Math.max(0, x0 - pad);
      y0 = Math.max(0, y0 - pad);
      const canvas = await renderPage(sel.page, nb, {
        only: new Set(selected),
        paper: 'blank',
        crop: { x: x0, y: y0, w: Math.ceil(x1 - x0 + pad), h: Math.ceil(y1 - y0 + pad) },
      });
      await writeClipboardPng(await canvasToBlob(canvas, 'image/png'));
    }
    toast(`Copied as ${mode === 'markdown' ? 'Markdown' : mode === 'text' ? 'plain text' : 'image'}`, undefined, 2000);
  } catch (e) {
    toast(`Copy failed: ${errMsg(e)}`);
  }
}

/** Ctrl/Cmd+C on a selection copies in the configured format. */
export const copyDefault = () => copySelection(app.copyAs);

// ---------- paste ----------

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

async function pasteImageFile(file: Blob) {
  const ext = EXT[file.type] ?? 'png';
  await addImage(toBase64(new Uint8Array(await file.arrayBuffer())), ext);
}

/** Browser path: the `paste` event carries the clipboard. */
export async function handlePasteEvent(e: ClipboardEvent) {
  const target = e.target;
  if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  const data = e.clipboardData;
  if (!data) return;
  const file = [...data.files].find((f) => f.type.startsWith('image/'));
  e.preventDefault();
  if (file) return pasteImageFile(file);
  const text = data.getData('text/plain');
  if (text) pasteText(text);
}

/** Text that was just copied from the PDF pane becomes a quote that cites its page. */
function pasteText(text: string) {
  const q = matchPdfCopy(text);
  if (q) addTextBlock(q.text, 'quote', q.ref);
  else addTextBlock(text);
}

/** Desktop path: read the system clipboard directly (WebKit does not reliably fire `paste` on a canvas). */
export async function pasteFromClipboard() {
  try {
    const img = await readImage().catch(() => null);
    if (img) {
      const { width, height } = await img.size();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(await img.rgba()), width, height), 0, 0);
      return pasteImageFile(await canvasToBlob(canvas, 'image/png'));
    }
    const text = await readText().catch(() => '');
    if (text) pasteText(text);
  } catch (e) {
    toast(`Paste failed: ${errMsg(e)}`);
  }
}

// ---------- export ----------

const assetBytes = async (nbId: string, asset: string) => fromBase64((await imageSrc(nbId, asset)).split(',')[1] ?? '');

async function pageCanvas(page: Page) {
  const nb = curNb()!;
  return renderPage(page, nb, { paper: paperOf(page, nb) });
}

async function canvasesToPdf(pages: Page[], progress?: (i: number) => void) {
  const out = [];
  for (const [i, p] of pages.entries()) {
    progress?.(i);
    const c = await pageCanvas(p);
    const jpeg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
    out.push({ jpeg, width: c.width, height: c.height });
  }
  return buildPdf(out, 0.75 / 2);
}

const pageName = (p: Page, i = 0) => slug(p.title) + (p.title ? '' : `-${i + 1}`);

export async function exportPage(kind: 'md' | 'png' | 'pdf') {
  const page = curPage();
  const nb = curNb();
  if (!page || !nb) return;
  app.exportOpen = false;
  try {
    const name = pageName(page);
    let path: string | null;
    if (kind === 'md') {
      path = await saveAs(name + '.md', pageToMarkdown(page, lineHeightOf(nb), exportOpts()), 'Markdown', 'md', 'text/markdown');
      if (path && inTauri) {
        for (const img of page.images.filter((i) => !i.deleted))
          await writeFileAt(`${dirname(path)}/assets/${img.asset}`, await assetBytes(nb.id, img.asset));
      }
    } else if (kind === 'png') {
      toast('Rendering…', undefined, 1500);
      const blob = await canvasToBlob(await pageCanvas(page), 'image/png');
      path = await saveAs(name + '.png', new Uint8Array(await blob.arrayBuffer()), 'PNG image', 'png', 'image/png');
    } else {
      toast('Rendering…', undefined, 1500);
      path = await saveAs(name + '.pdf', await canvasesToPdf([page]), 'PDF', 'pdf', 'application/pdf');
    }
    if (path) toast(`Saved ${path}`);
  } catch (e) {
    toast(`Export failed: ${errMsg(e)}`);
  }
}

export async function exportNotebook(kind: 'md' | 'pdf') {
  const nb = curNb();
  const pages = visiblePages();
  if (!nb || !pages.length) return;
  app.exportOpen = false;
  try {
    if (kind === 'md') {
      const dir = await chooseFolder('Choose where to put the exported notebook folder');
      if (!dir) return;
      const root = `${dir}/${slug(nb.name)}`;
      const L = lineHeightOf(nb);
      const copied = new Set<string>();
      for (const [i, p] of pages.entries()) {
        const file = `${String(i + 1).padStart(2, '0')}-${pageName(p, i)}.md`;
        await writeFileAt(`${root}/${file}`, pageToMarkdown(p, L, exportOpts()));
        for (const img of p.images.filter((x) => !x.deleted)) {
          if (copied.has(img.asset)) continue;
          copied.add(img.asset);
          await writeFileAt(`${root}/assets/${img.asset}`, await assetBytes(nb.id, img.asset));
        }
      }
      toast(`Exported ${pages.length} pages to ${root}`);
    } else {
      const pdf = await canvasesToPdf(pages, (i) => toast(`Rendering page ${i + 1} of ${pages.length}…`, undefined, 1200));
      const path = await saveAs(slug(nb.name) + '.pdf', pdf, 'PDF', 'pdf', 'application/pdf');
      if (path) toast(`Saved ${path}`);
    }
  } catch (e) {
    toast(`Export failed: ${errMsg(e)}`);
  }
}
