import { describe, expect, it } from 'vitest';
import { Outbox, type KeyValue } from './outbox';
import type { Page } from './types';

const mem = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const page = (id: string, title = ''): Page => ({ schema: 1, id, title, paper: 'default', tags: [], updatedAt: 't', blocks: [], images: [] });

describe('Outbox', () => {
  it('keeps one entry per page, newest wins', () => {
    const o = new Outbox(mem(), 'k');
    o.put('nb1', page('pg1', 'first'));
    o.put('nb1', page('pg2'));
    o.put('nb1', page('pg1', 'second'));
    expect(o.list().map((e) => [e.page.id, e.page.title])).toEqual([['pg2', ''], ['pg1', 'second']]);
  });
  it('removes entries and deletes the key when empty', () => {
    const s = mem();
    const o = new Outbox(s, 'k');
    o.put('nb1', page('pg1'));
    o.remove('pg1');
    expect(o.list()).toEqual([]);
    expect(s.data.has('k')).toBe(false);
  });
  it('survives corrupt or hostile stored data', () => {
    const s = mem();
    s.setItem('k', '{not json');
    expect(new Outbox(s, 'k').list()).toEqual([]);
    s.setItem('k', JSON.stringify([{ nb: 1 }, null, { nb: 'ok', page: { id: 'p' } }]));
    expect(new Outbox(s, 'k').list()).toHaveLength(1);
  });
  it('does not throw when storage refuses writes', () => {
    const o = new Outbox({ getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} }, 'k');
    expect(() => o.put('nb', page('p'))).not.toThrow();
  });
  it('is separate per key (per user)', () => {
    const s = mem();
    new Outbox(s, 'u1').put('nb', page('p'));
    expect(new Outbox(s, 'u2').list()).toEqual([]);
  });
});
