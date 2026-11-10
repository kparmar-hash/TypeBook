import { describe, expect, it } from 'vitest';
import { differs } from './canonical';
import { scrubBlock, scrubNotebook, scrubPage } from './tombstones';
import type { Block, Notebook, Page } from './types';

const blk = (extra: Partial<Block> = {}): Block => ({ id: 'a', x: 5, y: 6, text: 'secret', style: 'note', ink: 'red', updatedAt: 't', deleted: false, ...extra });
const page = (extra: Partial<Page> = {}): Page => ({ schema: 1, id: 'p', title: 'Private', paper: 'ruled', tags: ['x'], updatedAt: 't', blocks: [blk()], images: [{ id: 'i', x: 0, y: 0, size: 'm', asset: 'a.png', updatedAt: 't', deleted: false }], ...extra });

describe('scrub', () => {
  it('empties a deleted block but keeps what merging needs', () => {
    const out = scrubBlock(blk({ deleted: true, ref: { pdf: 'h', page: 3 } }));
    expect(out).toEqual({ id: 'a', x: 5, y: 6, text: '', style: 'note', ink: 'red', updatedAt: 't', deleted: true });
  });
  it('leaves live blocks alone', () => {
    const b = blk({ ref: { pdf: 'h', page: 3 } });
    expect(scrubBlock(b)).toBe(b);
  });
  it('empties a deleted page but keeps its identity and timestamps', () => {
    expect(scrubPage(page({ deleted: true }))).toEqual({ schema: 1, id: 'p', title: '', paper: 'ruled', tags: [], updatedAt: 't', blocks: [], images: [], deleted: true });
  });
  it('scrubs deleted blocks inside a live page, not the page', () => {
    const out = scrubPage(page({ blocks: [blk({ id: 'live' }), blk({ id: 'dead', deleted: true })] }));
    expect(out.title).toBe('Private');
    expect(out.blocks.map((b) => [b.id, b.text])).toEqual([['live', 'secret'], ['dead', '']]);
  });
  it('empties a deleted notebook', () => {
    const nb: Notebook = { schema: 1, id: 'n', name: 'My thesis', paper: 'ruled', font: 'caveat', fontSize: 24, ink: 'blue', margin: true, pageOrder: ['p1'], updatedAt: 't', deleted: true };
    expect(scrubNotebook(nb)).toMatchObject({ name: 'Deleted notebook', pageOrder: [], deleted: true });
    expect(scrubNotebook({ ...nb, deleted: false }).name).toBe('My thesis');
  });
  it('makes a locally deleted page compare equal to the server’s scrubbed copy', () => {
    const local = page({ deleted: true });
    const server = { ...local, title: '', tags: [], blocks: [], images: [] };
    expect(differs(local, server)).toBe(true);
    expect(differs(scrubPage(local), scrubPage(server))).toBe(false);
  });
});
