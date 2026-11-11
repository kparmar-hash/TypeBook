import type { Block, BlockStyle, ImageItem, Page, PdfRef } from './types';

const LABEL: Record<BlockStyle, string> = {
  normal: '',
  heading: '',
  definition: 'Definition',
  theorem: 'Theorem',
  exercise: 'Exercise',
  note: 'Note',
  quote: '',
};

type Item = { kind: 'block'; b: Block } | { kind: 'image'; i: ImageItem };

/**
 * Reading order: sort by y then x, and put items whose y values are within half a line height
 * on the same row (ordered left to right).
 */
export function readingRows(blocks: Block[], images: ImageItem[], lineHeight: number): Item[][] {
  const items: Item[] = [
    ...blocks.filter((b) => !b.deleted).map((b): Item => ({ kind: 'block', b })),
    ...images.filter((i) => !i.deleted).map((i): Item => ({ kind: 'image', i })),
  ];
  const pos = (it: Item) => (it.kind === 'block' ? it.b : it.i);
  items.sort((a, b) => pos(a).y - pos(b).y || pos(a).x - pos(b).x);
  const rows: Item[][] = [];
  let rowY = -Infinity;
  for (const it of items) {
    const y = pos(it).y;
    if (rows.length && y - rowY <= lineHeight / 2) rows[rows.length - 1].push(it);
    else {
      rows.push([it]);
      rowY = y;
    }
  }
  for (const r of rows) r.sort((a, b) => pos(a).x - pos(b).x);
  return rows;
}

export interface ExportOptions {
  /** prefix for image links, e.g. 'assets/' */
  assetBase?: string;
  /** display name of a PDF by hash, used when citing sources */
  pdfName?: (hash: string) => string | undefined;
}

const cite = (ref: PdfRef, opts: ExportOptions) => {
  const name = opts.pdfName?.(ref.pdf);
  return `${name ? name + ', ' : ''}p. ${ref.page}`;
};

function blockMarkdown(b: Block, opts: ExportOptions): string {
  const text = b.text.trimEnd();
  const source = b.ref ? cite(b.ref, opts) : '';
  switch (b.style) {
    case 'heading':
      return '## ' + text.replace(/\n+/g, ' ') + (source ? ` *(${source})*` : '');
    case 'quote':
      return [...text.split('\n').map((l) => '> ' + l), ...(source ? [`> — *${source}*`] : [])].join('\n');
    case 'normal':
      return text + (source ? ` *(${source})*` : '');
    default:
      return (
        text
          .split('\n')
          .map((l, i) => '> ' + (i === 0 ? `**${LABEL[b.style]}.** ` : '') + l)
          .join('\n') + (source ? `\n> — *${source}*` : '')
      );
  }
}

const joinRow = (parts: string[]) => (parts.some((p) => p.includes('\n')) ? parts.join('\n\n') : parts.join('  '));

export function blocksToMarkdown(
  blocks: Block[],
  images: ImageItem[],
  lineHeight: number,
  opts: ExportOptions = {},
): string {
  const base = opts.assetBase ?? 'assets/';
  return readingRows(blocks, images, lineHeight)
    .map((row) =>
      joinRow(row.map((it) => (it.kind === 'block' ? blockMarkdown(it.b, opts) : `![image](${base}${it.i.asset})`))),
    )
    .join('\n\n');
}

/** Strip inline markdown but keep math source readable. */
export function stripMarkup(text: string): string {
  const keep: string[] = [];
  const hold = (s: string) => `${keep.push(s) - 1}`;
  // code blocks keep their content untouched (their fence lines go); math keeps its source
  let s = text.replace(/```[^\n`]*\n([\s\S]*?)\n?```|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (m, code) => hold(code !== undefined ? code : m));
  s = s.replace(/`([^`\n]+)`/g, '$1').replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1').replace(/==([^=\n]+?)==/g, '$1');
  return s.replace(/(\d+)/g, (_, i) => keep[+i]);
}

export function blocksToPlainText(
  blocks: Block[],
  images: ImageItem[],
  lineHeight: number,
  opts: ExportOptions = {},
): string {
  return readingRows(blocks, images, lineHeight)
    .map((row) =>
      joinRow(
        row.map((it) => {
          if (it.kind === 'image') return '[image]';
          const t = stripMarkup(it.b.text.trimEnd()) + (it.b.ref ? ` (${cite(it.b.ref, opts)})` : '');
          return LABEL[it.b.style] ? `${LABEL[it.b.style]}: ${t}` : t;
        }),
      ),
    )
    .join('\n\n');
}

export function pageToMarkdown(page: Page, lineHeight: number, opts: ExportOptions = {}): string {
  const front: string[] = [];
  if (page.tags.length) front.push('---', `tags: [${page.tags.join(', ')}]`, '---', '');
  const head = page.title ? [`# ${page.title}`, ''] : [];
  return [...front, ...head, blocksToMarkdown(page.blocks, page.images, lineHeight, opts)].join('\n').trimEnd() + '\n';
}

export const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'untitled';
