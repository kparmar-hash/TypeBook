import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, string>();
let fsListener: ((e: { payload: string[] }) => void) | null = null;

const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'));
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, a: Record<string, string>) => {
    switch (cmd) {
      case 'read_text': {
        const v = files.get(a.path);
        if (v === undefined) throw new Error('ENOENT ' + a.path);
        return v;
      }
      case 'write_atomic':
        files.set(a.path, a.contents);
        return;
      case 'make_dir':
        return;
      case 'path_exists':
        return files.has(a.path) || [...files.keys()].some((k) => k.startsWith(a.path + '/'));
      case 'move_path': {
        files.set(a.to, files.get(a.from)!);
        files.delete(a.from);
        return;
      }
      case 'remove_path':
        files.delete(a.path);
        return;
      case 'list_dir': {
        const out = new Map<string, boolean>();
        for (const k of files.keys()) {
          if (!k.startsWith(a.path + '/')) continue;
          const rest = k.slice(a.path.length + 1);
          const [first, ...more] = rest.split('/');
          if (!first.startsWith('.')) out.set(first, more.length > 0);
        }
        return [...out].map(([name, is_dir]) => ({ name, is_dir }));
      }
      case 'watch_folder':
        return;
    }
    throw new Error('unmocked ' + cmd);
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_: string, cb: (e: { payload: string[] }) => void) => {
    fsListener = cb;
    return () => {};
  },
}));

const { FsPageStore } = await import('./fsStore');
import type { Block, ExternalChange, Page } from './types';

const ROOT = '/notes';
const ID = 'pg_01HZZZZZZZZZZZZZZZZZZZZZZZ';
const PAGE = `${ROOT}/notebooks/nb1/pages/${ID}.json`;
const T = (n: number) => `2026-11-09T14:00:${String(n).padStart(2, '0')}.000Z`;
const blk = (id: string, text: string, at: number): Block => ({
  id, x: 0, y: 0, text, style: 'normal', ink: 'black', updatedAt: T(at), deleted: false,
});
const page = (blocks: Block[], at: number): Page => ({
  schema: 1, id: ID, title: '', paper: 'default', tags: [], updatedAt: T(at), blocks, images: [],
});
const put = (path: string, p: unknown) => files.set(path, JSON.stringify(p));
const get = (path: string) => JSON.parse(files.get(path)!) as Page;
const conflictFiles = () => [...files.keys()].filter((k) => k.includes('/.conflicts/'));

beforeEach(() => {
  files.clear();
  fsListener = null;
});

describe('FsPageStore conflicts', () => {
  it('merges a sync conflict copy into the base page and moves it to .conflicts', async () => {
    put(PAGE, page([blk('a', 'mac', 5)], 5));
    put(`${ROOT}/notebooks/nb1/pages/${ID} (conflicted copy).json`, page([blk('a', 'old', 1), blk('b', 'linux', 6)], 6));
    const store = new FsPageStore(ROOT);

    expect(await store.resolveConflicts('nb1')).toBe(1);

    const merged = get(PAGE);
    expect(merged.blocks.map((b) => [b.id, b.text]).sort()).toEqual([['a', 'mac'], ['b', 'linux']]);
    expect(files.has(`${ROOT}/notebooks/nb1/pages/${ID} (conflicted copy).json`)).toBe(false);
    expect(conflictFiles()).toHaveLength(1);
    expect(conflictFiles()[0]).toMatch(/\/notes\/\.conflicts\/.*conflicted copy/);
  });

  it('adopts a conflict copy when the base file is missing', async () => {
    put(`${ROOT}/notebooks/nb1/pages/${ID}.sync-conflict-20261109-140000-ABC.json`, page([blk('a', 'x', 1)], 1));
    const store = new FsPageStore(ROOT);
    await store.resolveConflicts('nb1');
    expect(get(PAGE).blocks[0].text).toBe('x');
  });

  it('leaves an unreadable (still syncing) copy alone', async () => {
    const copy = `${ROOT}/notebooks/nb1/pages/${ID} 2.json`;
    put(PAGE, page([], 1));
    files.set(copy, '{"half');
    expect(await new FsPageStore(ROOT).resolveConflicts('nb1')).toBe(0);
    expect(files.has(copy)).toBe(true);
  });

  it('listPages ignores conflict copies', async () => {
    put(PAGE, page([blk('a', 'x', 1)], 1));
    put(`${ROOT}/notebooks/nb1/pages/${ID} (conflicted copy).json`, page([], 1));
    expect(await new FsPageStore(ROOT).listPages('nb1')).toHaveLength(1);
  });
});

describe('FsPageStore.savePage', () => {
  it('writes normally when nothing changed underneath', async () => {
    const store = new FsPageStore(ROOT);
    put(PAGE, page([blk('a', 'x', 1)], 1));
    await store.listPages('nb1'); // records what we saw
    expect(await store.savePage('nb1', page([blk('a', 'edited', 2)], 2))).toBeNull();
    expect(get(PAGE).blocks[0].text).toBe('edited');
  });

  it('folds in changes a sync tool wrote since we last looked instead of overwriting them', async () => {
    const store = new FsPageStore(ROOT);
    put(PAGE, page([blk('a', 'x', 1)], 1));
    await store.listPages('nb1');
    put(PAGE, page([blk('a', 'x', 1), blk('remote', 'from linux', 4)], 4)); // arrives behind our back

    const merged = await store.savePage('nb1', page([blk('a', 'edited locally', 5)], 5));

    expect(merged?.blocks.map((b) => b.id).sort()).toEqual(['a', 'remote']);
    expect(get(PAGE).blocks.find((b) => b.id === 'remote')?.text).toBe('from linux');
    expect(get(PAGE).blocks.find((b) => b.id === 'a')?.text).toBe('edited locally');
  });
});

describe('FsPageStore.watch', () => {
  const setup = async () => {
    const store = new FsPageStore(ROOT);
    const events: ExternalChange[] = [];
    await store.watch((c) => events.push(c));
    const fire = async (...paths: string[]) => {
      fsListener!({ payload: paths });
      await vi.waitFor(() => {}, { timeout: 10 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
    };
    return { store, events, fire };
  };

  it('ignores our own writes', async () => {
    const { store, events, fire } = await setup();
    await store.savePage('nb1', page([blk('a', 'x', 1)], 1));
    await fire(PAGE);
    expect(events).toEqual([]);
  });

  it('reports an external page change once', async () => {
    const { store, events, fire } = await setup();
    await store.savePage('nb1', page([blk('a', 'x', 1)], 1));
    put(PAGE, page([blk('a', 'x', 1), blk('b', 'remote', 3)], 3));
    await fire(PAGE, PAGE);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'page', nbId: 'nb1', conflict: false });
    await fire(PAGE); // same contents again: already seen
    expect(events).toHaveLength(1);
  });

  it('ignores temp files and non-page files', async () => {
    const { events, fire } = await setup();
    await fire(`${ROOT}/notebooks/nb1/pages/.${ID}.json.1.tmp`, `${ROOT}/typebook.json`, `${ROOT}/notebooks/nb1/assets/a.png`);
    expect(events).toEqual([]);
  });

  it('merges a conflict copy that appears while running and reports the merged page', async () => {
    const { store, events, fire } = await setup();
    await store.savePage('nb1', page([blk('a', 'mac', 5)], 5));
    const copy = `${ROOT}/notebooks/nb1/pages/${ID} (conflicted copy).json`;
    put(copy, page([blk('b', 'linux', 6)], 6));
    await fire(copy);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'page', conflict: true });
    expect((events[0] as { page: Page }).page.blocks.map((b) => b.id).sort()).toEqual(['a', 'b']);
    expect(conflictFiles()).toHaveLength(1);
    // the follow-up event for the merged base file is our own write
    await fire(PAGE);
    expect(events).toHaveLength(1);
  });
});
