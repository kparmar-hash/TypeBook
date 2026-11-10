import { describe, expect, it } from 'vitest';
import { blocksToMarkdown, blocksToPlainText, pageToMarkdown, readingRows, slug, stripMarkup } from './exportMd';
import type { Block, ImageItem, Page } from './types';

const blk = (id: string, x: number, y: number, text: string, extra: Partial<Block> = {}): Block => ({
  id, x, y, text, style: 'normal', ink: 'black', updatedAt: '', deleted: false, ...extra,
});
const L = 34;

describe('reading order', () => {
  it('sorts by y then x', () => {
    const rows = readingRows([blk('b', 0, 200, 'B'), blk('a', 0, 100, 'A')], [], L);
    expect(rows.flat().map((r) => (r.kind === 'block' ? r.b.id : ''))).toEqual(['a', 'b']);
  });
  it('groups blocks within half a line height into one row, left to right', () => {
    const rows = readingRows([blk('r', 400, 110, 'R'), blk('l', 50, 100, 'L'), blk('n', 50, 140, 'N')], [], L);
    expect(rows).toHaveLength(2);
    expect(rows[0].map((r) => (r.kind === 'block' ? r.b.id : ''))).toEqual(['l', 'r']);
  });
  it('does not group blocks a full line apart', () => {
    expect(readingRows([blk('a', 0, 100, 'A'), blk('b', 0, 100 + L, 'B')], [], L)).toHaveLength(2);
  });
  it('skips deleted blocks', () => {
    expect(readingRows([blk('a', 0, 0, 'A', { deleted: true })], [], L)).toEqual([]);
  });
});

describe('markdown', () => {
  it('keeps math as $…$ and joins rows', () => {
    const md = blocksToMarkdown([blk('a', 0, 0, 'gcd $m,n$'), blk('b', 300, 0, 'right'), blk('c', 0, 100, '- x\n- y')], [], L);
    expect(md).toBe('gcd $m,n$  right\n\n- x\n- y');
  });
  it('renders styles', () => {
    const md = blocksToMarkdown(
      [blk('h', 0, 0, 'Title', { style: 'heading' }), blk('d', 0, 100, 'A thing\nmore', { style: 'definition' })],
      [],
      L,
    );
    expect(md).toBe('## Title\n\n> **Definition.** A thing\n> more');
  });
  it('links images', () => {
    const img: ImageItem = { id: 'i', x: 0, y: 50, size: 'm', asset: 'x.png', updatedAt: '', deleted: false };
    expect(blocksToMarkdown([blk('a', 0, 0, 'hi')], [img], L)).toBe('hi\n\n![image](assets/x.png)');
  });
  it('writes a page with title and tags', () => {
    const page: Page = { schema: 1, id: 'p', title: 'Ch 1', paper: 'default', tags: ['a', 'b'], updatedAt: '', blocks: [blk('a', 0, 0, 'hi')], images: [] };
    expect(pageToMarkdown(page, L)).toBe('---\ntags: [a, b]\n---\n\n# Ch 1\n\nhi\n');
  });
});

describe('pdf references', () => {
  const ref = { pdf: 'h1', page: 52 };
  const opts = { pdfName: (h: string) => (h === 'h1' ? 'TAOCP vol 1.pdf' : undefined) };
  it('cites the source of a quote', () => {
    const md = blocksToMarkdown([blk('q', 0, 0, 'An algorithm is a finite set of rules', { style: 'quote', ref })], [], L, opts);
    expect(md).toBe('> An algorithm is a finite set of rules\n> — *TAOCP vol 1.pdf, p. 52*');
  });
  it('adds a page note to ordinary blocks, with or without a known name', () => {
    expect(blocksToMarkdown([blk('a', 0, 0, 'see this', { ref })], [], L, opts)).toBe('see this *(TAOCP vol 1.pdf, p. 52)*');
    expect(blocksToMarkdown([blk('a', 0, 0, 'see this', { ref: { pdf: 'zz', page: 3 } })], [], L, opts)).toBe('see this *(p. 3)*');
  });
  it('shows the page in plain text', () => {
    expect(blocksToPlainText([blk('a', 0, 0, '**x**', { ref })], [], L, opts)).toBe('x (TAOCP vol 1.pdf, p. 52)');
  });
});

describe('plain text', () => {
  it('strips formatting but keeps math source', () => {
    expect(stripMarkup('**b** *i* ==h== `c` $a*b*c$')).toBe('b i h c $a*b*c$');
  });
  it('labels styled blocks', () => {
    expect(blocksToPlainText([blk('a', 0, 0, '**x**', { style: 'theorem' })], [], L)).toBe('Theorem: x');
  });
});

describe('slug', () => {
  it('makes file-safe names', () => {
    expect(slug('Ch 1.1: Algorithms!')).toBe('ch-1-1-algorithms');
    expect(slug('???')).toBe('untitled');
  });
});
