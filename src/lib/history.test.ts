import { describe, expect, it } from 'vitest';
import { History, restoreBlocks, type Snapshot } from './history';
import type { Block } from './types';

const blk = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id, x: 0, y: 0, text, style: 'normal', ink: 'black', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, ...extra,
});
const snap = (...blocks: Block[]): Snapshot => ({ title: '', paper: 'default', tags: [], blocks, images: [] });

describe('History', () => {
  it('undoes and redoes', () => {
    const h = new History();
    h.push(snap(blk('a', '1')));
    const back = h.undo(snap(blk('a', '2')));
    expect(back?.blocks[0].text).toBe('1');
    expect(h.redo(snap(blk('a', '1')))?.blocks[0].text).toBe('2');
    expect(h.canUndo).toBe(true);
  });
  it('clears redo on new change', () => {
    const h = new History();
    h.push(snap());
    h.undo(snap(blk('a', 'x')));
    h.push(snap());
    expect(h.canRedo).toBe(false);
  });
  it('respects the limit', () => {
    const h = new History(2);
    for (let i = 0; i < 5; i++) h.push(snap(blk('a', String(i))));
    h.undo(snap()); h.undo(snap());
    expect(h.undo(snap())).toBeNull();
  });
});

describe('restoreBlocks', () => {
  const now = '2026-02-02T00:00:00.000Z';
  it('tombstones blocks missing from the target', () => {
    const out = restoreBlocks([blk('a', 'x')], [], now);
    expect(out).toEqual([blk('a', 'x', { deleted: true, updatedAt: now })]);
  });
  it('revives and re-stamps changed blocks, leaves unchanged ones alone', () => {
    const out = restoreBlocks(
      [blk('a', 'x', { deleted: true }), blk('b', 'same')],
      [blk('a', 'x'), blk('b', 'same')],
      now,
    );
    expect(out[0]).toMatchObject({ id: 'a', deleted: false, updatedAt: now });
    expect(out[1].updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
