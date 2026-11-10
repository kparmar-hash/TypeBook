import { describe, expect, it } from 'vitest';
import { conflictBase, isPageFile, mergeItems, mergeLibraries, mergeNotebooks, mergePages } from './merge';
import type { Block, ImageItem, Notebook, Page } from './types';

const T = (n: number) => `2026-11-09T14:00:${String(n).padStart(2, '0')}.000Z`;

const blk = (id: string, text: string, at: number, extra: Partial<Block> = {}): Block => ({
  id, x: 10, y: 10, text, style: 'normal', ink: 'black', updatedAt: T(at), deleted: false, ...extra,
});
const page = (blocks: Block[], at: number, extra: Partial<Page> = {}): Page => ({
  schema: 1, id: 'pg_1', title: 'T', paper: 'ruled', tags: [], updatedAt: T(at), blocks, images: [], ...extra,
});
const byId = <X extends { id: string }>(xs: X[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const sameMerge = (a: Page, b: Page) => {
  const ab = mergePages(a, b);
  const ba = mergePages(b, a);
  expect(byId(ab.blocks)).toEqual(byId(ba.blocks));
  expect({ ...ab, blocks: [] }).toEqual({ ...ba, blocks: [] });
  return ab;
};

describe('mergePages: two devices editing different blocks', () => {
  it('keeps both edits', () => {
    const base = [blk('a', 'one', 1), blk('b', 'two', 1)];
    const mac = page([blk('a', 'one (mac)', 5), base[1]], 5);
    const linux = page([base[0], blk('b', 'two (linux)', 6)], 6);
    const m = sameMerge(mac, linux);
    expect(m.blocks.find((b) => b.id === 'a')!.text).toBe('one (mac)');
    expect(m.blocks.find((b) => b.id === 'b')!.text).toBe('two (linux)');
  });

  it('unions blocks that exist on one side only', () => {
    const m = sameMerge(page([blk('a', 'x', 1)], 1), page([blk('b', 'y', 2)], 2));
    expect(byId(m.blocks).map((b) => b.id)).toEqual(['a', 'b']);
  });
});

describe('mergePages: the same block edited on both devices', () => {
  it('newest updatedAt wins', () => {
    const m = sameMerge(page([blk('a', 'older', 5)], 5), page([blk('a', 'newer', 9)], 9));
    expect(m.blocks).toHaveLength(1);
    expect(m.blocks[0].text).toBe('newer');
  });

  it('is deterministic on an exact timestamp tie', () => {
    const m = sameMerge(page([blk('a', 'left', 5)], 5), page([blk('a', 'right', 5)], 5));
    expect(m.blocks).toHaveLength(1);
  });

  it('moves and style changes merge as whole-block winners', () => {
    const m = sameMerge(
      page([blk('a', 't', 5, { x: 100 })], 5),
      page([blk('a', 't', 8, { x: 300, style: 'theorem' })], 8),
    );
    expect(m.blocks[0]).toMatchObject({ x: 300, style: 'theorem' });
  });
});

describe('mergePages: delete vs edit', () => {
  it('a newer tombstone beats an older edit', () => {
    const edited = page([blk('a', 'edited', 5)], 5);
    const deleted = page([blk('a', 'orig', 8, { deleted: true })], 8);
    expect(sameMerge(edited, deleted).blocks[0].deleted).toBe(true);
  });

  it('a newer edit beats an older tombstone', () => {
    const deleted = page([blk('a', 'orig', 5, { deleted: true })], 5);
    const edited = page([blk('a', 'edited', 8)], 8);
    const m = sameMerge(deleted, edited);
    expect(m.blocks[0]).toMatchObject({ deleted: false, text: 'edited' });
  });

  it('a tombstone wins a timestamp tie', () => {
    const m = sameMerge(page([blk('a', 'x', 5)], 5), page([blk('a', 'x', 5, { deleted: true })], 5));
    expect(m.blocks[0].deleted).toBe(true);
  });

  it('does not resurrect a deleted block that a stale device still has', () => {
    const stale = page([blk('a', 'still here', 1)], 1);
    const current = page([blk('a', 'still here', 6, { deleted: true })], 6);
    expect(sameMerge(stale, current).blocks[0].deleted).toBe(true);
  });
});

describe('mergePages: offline edit then reconnect', () => {
  const ancestor = page([blk('a', 'a0', 1), blk('b', 'b0', 1), blk('c', 'c0', 1)], 1);

  it('converges whatever order the devices sync in', () => {
    // Device A is offline for a while: edits a, deletes c, adds d.
    const a = page([blk('a', 'a-offline', 20), ancestor.blocks[1], blk('c', 'c0', 21, { deleted: true }), blk('d', 'new', 22)], 22);
    // Device B stays online: edits b and a (earlier than A's edit of a).
    const b = page([blk('a', 'a-online', 10), blk('b', 'b-online', 11), ancestor.blocks[2]], 11);
    const m = sameMerge(a, b);
    const get = (id: string) => m.blocks.find((x) => x.id === id)!;
    expect(get('a').text).toBe('a-offline');
    expect(get('b').text).toBe('b-online');
    expect(get('c').deleted).toBe(true);
    expect(get('d').text).toBe('new');
    expect(m.updatedAt).toBe(T(22));
  });

  it('is idempotent and associative across three devices', () => {
    const x = page([blk('a', 'x', 3)], 3);
    const y = page([blk('a', 'y', 4), blk('b', 'y', 4)], 4);
    const z = page([blk('b', 'z', 5), blk('c', 'z', 5)], 5);
    const left = mergePages(mergePages(x, y), z);
    const right = mergePages(x, mergePages(y, z));
    expect(byId(left.blocks)).toEqual(byId(right.blocks));
    expect(byId(mergePages(left, left).blocks)).toEqual(byId(left.blocks));
  });
});

describe('mergePages: page-level fields and images', () => {
  it('newest page wins for title, tags, paper', () => {
    const a = page([], 5, { title: 'old', tags: ['x'], paper: 'ruled' });
    const b = page([], 9, { title: 'new', tags: ['y'], paper: 'dots' });
    const m = sameMerge(a, b);
    expect(m).toMatchObject({ title: 'new', tags: ['y'], paper: 'dots', updatedAt: T(9) });
  });

  it('a newer page tombstone wins', () => {
    const m = sameMerge(page([], 5), page([], 9, { deleted: true }));
    expect(m.deleted).toBe(true);
  });

  it('merges images like blocks', () => {
    const img = (id: string, at: number, extra: Partial<ImageItem> = {}): ImageItem => ({
      id, x: 0, y: 0, size: 'm', asset: id + '.png', updatedAt: T(at), deleted: false, ...extra,
    });
    const m = mergePages(page([], 1, { images: [img('i1', 2), img('i2', 3)] }), page([], 1, { images: [img('i1', 5, { size: 'l' }), img('i3', 4)] }));
    expect(byId(m.images).map((i) => [i.id, i.size])).toEqual([['i1', 'l'], ['i2', 'm'], ['i3', 'm']]);
  });

  it('does not mutate its inputs', () => {
    const a = page([blk('a', 'x', 1)], 1);
    const b = page([blk('a', 'y', 2)], 2);
    const snapshot = JSON.stringify([a, b]);
    mergePages(a, b);
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});

describe('mergeItems', () => {
  it('handles empty sides', () => {
    expect(mergeItems([], [])).toEqual([]);
    expect(mergeItems([blk('a', 'x', 1)], [])).toHaveLength(1);
  });
});

describe('mergeNotebooks', () => {
  const nb = (at: number, order: string[], name = 'N'): Notebook => ({
    schema: 1, id: 'nb', name, paper: 'ruled', font: 'caveat', fontSize: 24, ink: 'blue', margin: true, pageOrder: order, updatedAt: T(at),
  });
  it('newest settings win and unknown pages are kept', () => {
    const m = mergeNotebooks(nb(5, ['p1', 'p2'], 'old'), nb(9, ['p2', 'p3'], 'new'));
    expect(m.name).toBe('new');
    expect(m.pageOrder).toEqual(['p2', 'p3', 'p1']);
  });
});

describe('conflict file names', () => {
  const id = 'pg_01HZZZZZZZZZZZZZZZZZZZZZZZ';
  it('recognises copies made by common sync tools', () => {
    for (const name of [`${id} (conflicted copy).json`, `${id}.sync-conflict-20261109-140322-ABCDEFG.json`, `${id} 2.json`, `${id} (Alice's conflicted copy 2026-11-09).json`]) {
      expect(conflictBase(name)).toEqual({ kind: 'page', base: id + '.json' });
    }
    expect(conflictBase('notebook (conflicted copy).json')).toEqual({ kind: 'notebook', base: 'notebook.json' });
  });
  it('does not treat normal files as conflicts', () => {
    expect(conflictBase(`${id}.json`)).toBeNull();
    expect(conflictBase('notebook.json')).toBeNull();
    expect(conflictBase('typebook.json')).toBeNull();
    expect(isPageFile(`${id}.json`)).toBe(true);
    expect(isPageFile(`${id} 2.json`)).toBe(false);
  });
});

describe('mergeLibraries', () => {
  it('unions PDF registries from two devices', () => {
    const a = { schema: 1 as const, createdAt: '2026-01-02', pdfs: { h1: { name: 'TAOCP vol 1.pdf' } } };
    const b = { schema: 1 as const, createdAt: '2026-01-01', pdfs: { h2: { name: 'Concrete Math.pdf' } } };
    const m = mergeLibraries(a, b);
    expect(Object.keys(m.pdfs!).sort()).toEqual(['h1', 'h2']);
    expect(m.createdAt).toBe('2026-01-01');
    expect(mergeLibraries(b, a).pdfs).toEqual(m.pdfs);
  });
  it('tolerates a library without pdfs', () => {
    expect(mergeLibraries({ schema: 1, createdAt: 'x' }, { schema: 1, createdAt: 'y', pdfs: { h: { name: 'n' } } }).pdfs).toEqual({ h: { name: 'n' } });
  });
});
