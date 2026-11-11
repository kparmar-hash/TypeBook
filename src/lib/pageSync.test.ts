import { describe, expect, it } from 'vitest';
import { mergePages } from './merge';
import { normalizePage, notebookDiffers, pageDiffers, patchPage } from './pageSync';
import type { Block, Notebook, Page } from './types';

const T = (n: number) => new Date(Date.UTC(2026, 10, 9, 14, 0, n)).toISOString();
const blk = (id: string, text: string, at: number, extra: Partial<Block> = {}): Block => ({ id, x: 1, y: 2, text, style: 'normal', ink: 'black', updatedAt: T(at), deleted: false, ...extra });
const page = (blocks: Block[], at = 1, extra: Partial<Page> = {}): Page => ({ schema: 1, id: 'p', title: 'T', paper: 'ruled', tags: [], updatedAt: T(at), blocks, images: [], ...extra });

describe('pageDiffers', () => {
  it('ignores block order: a database returns blocks sorted, the app keeps creation order', () => {
    const local = page([blk('b_C', 'c', 1), blk('b_A', 'a', 1), blk('b_B', 'b', 1)]);
    const server = page([blk('b_A', 'a', 1), blk('b_B', 'b', 1), blk('b_C', 'c', 1)]);
    expect(pageDiffers(local, server)).toBe(false);
  });
  it('ignores key order inside blocks', () => {
    const a = page([blk('b_A', 'x', 1)]);
    const b = page([JSON.parse(JSON.stringify({ updatedAt: T(1), deleted: false, id: 'b_A', text: 'x', ink: 'black', style: 'normal', y: 2, x: 1 }))]);
    expect(pageDiffers(a, b)).toBe(false);
  });
  it('ignores a block that is still being typed into and has no text yet', () => {
    expect(pageDiffers(page([blk('b_A', 'a', 1), blk('b_new', '', 2)]), page([blk('b_A', 'a', 1)]))).toBe(false);
  });
  it('ignores the content the server empties from deleted things', () => {
    const local = page([blk('b_A', 'secret', 3, { deleted: true, ref: { pdf: 'h', page: 1 } })]);
    const server = page([blk('b_A', '', 3, { deleted: true })]);
    expect(pageDiffers(local, server)).toBe(false);
    expect(pageDiffers(page([blk('b_A', 'a', 1)], 2, { deleted: true, title: 'x' }), page([], 2, { deleted: true, title: '' }))).toBe(false);
  });
  it('still sees real differences', () => {
    expect(pageDiffers(page([blk('b_A', 'a', 1)]), page([blk('b_A', 'a edited', 2)]))).toBe(true);
    expect(pageDiffers(page([blk('b_A', 'a', 1)]), page([blk('b_A', 'a', 1), blk('b_B', 'b', 1)]))).toBe(true);
    expect(pageDiffers(page([blk('b_A', 'a', 1)]), page([blk('b_A', 'a', 4, { deleted: true })]))).toBe(true);
    expect(pageDiffers(page([], 1, { title: 'a' }), page([], 1, { title: 'b' }))).toBe(true);
  });
  it('normalizePage does not mutate its input', () => {
    const p = page([blk('b_B', 'b', 1), blk('b_A', 'a', 1)]);
    normalizePage(p);
    expect(p.blocks.map((b) => b.id)).toEqual(['b_B', 'b_A']);
  });
});

describe('patchPage', () => {
  it('changes nothing when nothing differs, keeping the very same objects and their order', () => {
    const p = page([blk('b_C', 'c', 1), blk('b_A', 'a', 1)]);
    const [first, second] = p.blocks;
    patchPage(p, page([blk('b_A', 'a', 1), blk('b_C', 'c', 1)]));
    expect(p.blocks[0]).toBe(first);
    expect(p.blocks[1]).toBe(second);
    expect(p.blocks.map((b) => b.id)).toEqual(['b_C', 'b_A']);
  });
  it('updates only the blocks that changed, in place, and appends new ones at the end', () => {
    const p = page([blk('b_A', 'a', 1), blk('b_B', 'b', 1)]);
    const [a, b] = p.blocks;
    patchPage(p, page([blk('b_A', 'a', 1), blk('b_B', 'b edited elsewhere', 5), blk('b_Z', 'from another device', 4)], 5));
    expect(p.blocks[0]).toBe(a);
    expect(p.blocks[1]).toBe(b);
    expect(b.text).toBe('b edited elsewhere');
    expect(p.blocks.map((x) => x.id)).toEqual(['b_A', 'b_B', 'b_Z']);
    expect(p.updatedAt).toBe(T(5));
  });
  it('never drops a block that has not been saved yet, even one with text typed after the merge was computed', () => {
    const p = page([blk('b_A', 'a', 1), blk('b_typing', 'hello', 9)]);
    patchPage(p, page([blk('b_A', 'a', 1)])); // a merge result that predates the new block
    expect(p.blocks.map((b) => b.id)).toEqual(['b_A', 'b_typing']);
    expect(p.blocks[1].text).toBe('hello');
  });
  it('removes properties a block no longer has (a cleared PDF link)', () => {
    const p = page([blk('b_A', 'a', 1, { ref: { pdf: 'h', page: 2 } })]);
    patchPage(p, page([blk('b_A', 'a', 3)], 3));
    expect(p.blocks[0]).not.toHaveProperty('ref');
  });
  it('keeps our content when the page arrives deleted, so Undo still works', () => {
    const p = page([blk('b_A', 'my notes', 1)], 1, { title: 'Chapter 1', tags: ['x'] });
    patchPage(p, page([], 8, { deleted: true, title: '', tags: [] }));
    expect(p).toMatchObject({ deleted: true, title: 'Chapter 1', tags: ['x'], updatedAt: T(8) });
    expect(p.blocks[0].text).toBe('my notes');
    patchPage(p, page([blk('b_A', 'my notes', 1)], 12)); // restored
    expect(p.deleted).toBeUndefined();
  });
  it('applying a merge computed from a stale snapshot never reverts newer local edits', () => {
    const atFlush = page([blk('b_A', 'hello', 1), blk('b_X', 'to be deleted', 1)], 1);
    // while the save was in flight the user kept typing, added a block and deleted another
    const live = page([blk('b_A', 'hello world', 5), blk('b_X', 'to be deleted', 5, { deleted: true }), blk('b_N', 'brand new', 5)], 5);
    const serverReply = page([blk('b_A', 'hello', 1), blk('b_X', 'to be deleted', 1), blk('b_D', 'from device two', 3)], 3); // merge of the stale snapshot
    const next = mergePages(live, serverReply);
    patchPage(live, next);
    const text = Object.fromEntries(live.blocks.map((b) => [b.id, b.deleted ? '(deleted)' : b.text]));
    expect(text).toEqual({ b_A: 'hello world', b_X: '(deleted)', b_N: 'brand new', b_D: 'from device two' });
  });
});

describe('notebookDiffers', () => {
  const nb = (pageOrder: string[], extra: Partial<Notebook> = {}): Notebook => ({ schema: 1, id: 'n', name: 'N', paper: 'ruled', font: 'caveat', fontSize: 24, ink: 'blue', margin: true, pageOrder, updatedAt: T(1), ...extra });
  it('ignores ids of pages that are not live (the server keeps re-adding deleted pages to the order)', () => {
    const live = new Set(['p1', 'p2']);
    expect(notebookDiffers(nb(['p1', 'p2']), nb(['p1', 'p2', 'p3-deleted']), live)).toBe(false);
  });
  it('still sees a real change of order or of live pages', () => {
    const live = new Set(['p1', 'p2', 'p3']);
    expect(notebookDiffers(nb(['p1', 'p2']), nb(['p2', 'p1']), live)).toBe(true);
    expect(notebookDiffers(nb(['p1']), nb(['p1', 'p3']), live)).toBe(true);
    expect(notebookDiffers(nb(['p1']), nb(['p1'], { name: 'Renamed' }), live)).toBe(true);
  });
  it('compares the raw order when live pages are not known', () => {
    expect(notebookDiffers(nb(['p1']), nb(['p1', 'p2']))).toBe(true);
  });
});
