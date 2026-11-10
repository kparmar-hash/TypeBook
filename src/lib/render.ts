import { toCanvas } from 'html-to-image';
import { mount, tick, unmount } from 'svelte';
import { PAGE_W } from './app.svelte';
import PageRender from './PageRender.svelte';
import type { Notebook, Page, Paper } from './types';

export interface RenderOptions {
  /** render only these block/image ids */
  only?: Set<string>;
  /** crop rectangle in sheet pixels; defaults to the full page width and its content height */
  crop?: { x: number; y: number; w: number; h: number };
  paper: Paper;
  pixelRatio?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isChromium = () => /Chrome|Chromium/.test(navigator.userAgent);

/** Rasterise a page (always on light paper, so exports print and share well). */
export async function renderPage(page: Page, nb: Notebook, opts: RenderOptions): Promise<HTMLCanvasElement> {
  const pixelRatio = opts.pixelRatio ?? 2;
  const host = document.createElement('div');
  host.className = 'force-light';
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:-9999;pointer-events:none;overflow:hidden;';
  const inner = document.createElement('div');
  host.appendChild(inner);
  document.body.appendChild(host);
  const comp = mount(PageRender, { target: inner, props: { page, nb, paper: opts.paper, only: opts.only ?? null } });
  try {
    await tick();
    await document.fonts.ready;
    for (let i = 0; i < 40 && host.querySelector('.loading'); i++) await sleep(50);
    await Promise.all(
      [...host.querySelectorAll('img')].map((img) =>
        img.complete ? Promise.resolve() : new Promise((r) => ((img.onload = img.onerror = () => r(null)), undefined)),
      ),
    );

    const items = [...host.querySelectorAll<HTMLElement>('[data-item]')];
    const bottom = Math.max(0, ...items.map((el) => el.offsetTop + el.offsetHeight));
    const crop = opts.crop ?? { x: 0, y: 0, w: PAGE_W, h: Math.max(320, bottom + 48) };
    host.style.width = crop.w + 'px';
    host.style.height = crop.h + 'px';
    inner.style.cssText = `position:absolute;left:${-crop.x}px;top:${-crop.y}px;`;
    const sheet = inner.firstElementChild as HTMLElement;
    sheet.style.height = crop.y + crop.h + 'px';
    sheet.style.borderRadius = '0';
    const backgroundColor = getComputedStyle(sheet).backgroundColor;
    const options = { pixelRatio, backgroundColor, width: crop.w, height: crop.h };
    // WebKit needs a warm-up pass before fonts and images show up in the SVG snapshot.
    if (!isChromium()) await toCanvas(host, options);
    return await toCanvas(host, options);
  } finally {
    unmount(comp);
    host.remove();
  }
}

export const canvasToBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  );
