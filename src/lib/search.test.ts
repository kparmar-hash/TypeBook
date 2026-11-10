import { describe, expect, it } from 'vitest';
import { entryOf, search } from './search';
import type { Block, Page } from './types';

const blk = (id: string, text: string, y = 0, extra: Partial<Block> = {}): Block => ({
  id, x: 0, y, text, style: 'normal', ink: 'black', updatedAt: '', deleted: false, ...extra,
});
const mk = (id: string, title: string, tags: string[], blocks: Block[], updatedAt = '2026-01-01'): Page => ({
  schema: 1, id, title, paper: 'default', tags, updatedAt, blocks, images: [],
});

const index = [
  entryOf('n1', 'TAOCP', mk('p1', 'Euclid', ['taocp', 'vol1'], [blk('a', "Algorithm E: $\\gcd(m,n)$ via remainder")])),
  entryOf('n1', 'TAOCP', mk('p2', 'Misc', [], [blk('a', 'a note about gcd in the body')], '2026-02-01')),
  entryOf('n2', 'Other', mk('p3', 'Fibonacci', ['math'], [blk('a', '$F_n = F_{n-1} + F_{n-2}$'), blk('b', 'gone', 5, { deleted: true })])),
];

describe('search', () => {
  it('finds text inside math source', () => {
    expect(search(index, '\\gcd').map((h) => h.entry.pageId)).toEqual(['p1']);
    expect(search(index, 'F_{n-1}').map((h) => h.entry.pageId)).toEqual(['p3']);
  });
  it('ranks title above tag above body, then by recency', () => {
    expect(search(index, 'euclid')[0].entry.pageId).toBe('p1');
    expect(search(index, 'gcd').map((h) => h.entry.pageId)).toEqual(['p2', 'p1']);
  });
  it('requires every term', () => {
    expect(search(index, 'gcd remainder').map((h) => h.entry.pageId)).toEqual(['p1']);
    expect(search(index, 'gcd fibonacci')).toEqual([]);
  });
  it('filters by #tag, across notebooks', () => {
    expect(search(index, '#math').map((h) => h.entry.pageId)).toEqual(['p3']);
    expect(search(index, '#taocp gcd').map((h) => h.entry.pageId)).toEqual(['p1']);
  });
  it('ignores deleted blocks and empty queries', () => {
    expect(search(index, 'gone')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
  });
  it('returns a snippet around the match', () => {
    expect(search(index, 'remainder')[0].snippet).toContain('remainder');
  });
});
