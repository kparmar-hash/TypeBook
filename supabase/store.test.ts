/**
 * SupabaseStore against the REAL migration running in Postgres. The store's `Remote` is implemented here on PGlite,
 * acting as a signed-in user, so row security, the merging save_* functions and the storage policies are all in play.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SupabaseStore, type Remote, type Row, type Table } from '../src/lib/supabaseStore';
import { ulid } from '../src/lib/ulid';
import type { Block, ExternalChange, Notebook, Page } from '../src/lib/types';
import { ALICE, BOB, newDb } from './harness';

// ---------- a Remote on Postgres ----------

const locks = new WeakMap<PGlite, Promise<unknown>>();
const blobs = new Map<string, Uint8Array>();

class PgRemote implements Remote {
  rows: Array<(table: 'notebooks' | 'pages', row: Row) => void> = [];
  status: Array<(s: 'up' | 'down') => void> = [];
  constructor(private db: PGlite, private uid: string) {}
  userId = () => this.uid;

  /** Run as this user. Serialised per database so two "devices" never interleave their role changes. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const job = (locks.get(this.db) ?? Promise.resolve()).then(async () => {
      await this.db.exec('set role authenticated');
      await this.db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [this.uid]);
      try {
        return await fn();
      } finally {
        await this.db.exec('reset role');
      }
    });
    locks.set(this.db, job.catch(() => {}));
    return job;
  }

  private shape(r: Row): Row {
    // PostgREST returns timestamps as ISO strings
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().replace('Z', '+00:00') : v]));
  }

  rpc(fn: string, a: Record<string, unknown>) {
    return this.run(async () => {
      const q: Record<string, [string, unknown[]]> = {
        save_page: ['select public.save_page($1, $2::jsonb) as r', [a.p_notebook_id, JSON.stringify(a.p_page)]],
        save_notebook: ['select public.save_notebook($1::jsonb) as r', [JSON.stringify(a.p_notebook)]],
        purge_tombstones: ['select public.purge_tombstones() as r', []],
      };
      return (await this.db.query<{ r: any }>(...q[fn])).rows[0].r;
    });
  }

  select(table: Table, q: { eq?: Record<string, string>; gt?: Record<string, string> } = {}) {
    return this.run(async () => {
      const where: string[] = [];
      const params: unknown[] = [];
      for (const [k, v] of Object.entries(q.eq ?? {})) (params.push(v), where.push(`${k} = $${params.length}`));
      for (const [k, v] of Object.entries(q.gt ?? {})) (params.push(v), where.push(`${k} > $${params.length}::timestamptz`));
      const sql = `select * from public.${table} ${where.length ? 'where ' + where.join(' and ') : ''} order by ${table === 'pdfs' ? 'hash' : 'id'}`;
      return (await this.db.query<Row>(sql, params)).rows.map((r) => this.shape(r));
    });
  }

  insertPdfs(rows: { hash: string; name: string }[]) {
    return this.run(async () => {
      for (const r of rows) await this.db.query('insert into public.pdfs (hash, name) values ($1, $2) on conflict do nothing', [r.hash, r.name]);
    });
  }

  upload(path: string, bytes: Uint8Array) {
    return this.run(async () => {
      const have = await this.db.query(`select 1 from storage.objects where bucket_id = 'assets' and name = $1`, [path]);
      if (!have.rows.length) await this.db.query(`insert into storage.objects (bucket_id, name) values ('assets', $1)`, [path]);
      blobs.set(path, bytes);
    });
  }

  download(path: string) {
    return this.run(async () => {
      const have = await this.db.query(`select 1 from storage.objects where bucket_id = 'assets' and name = $1`, [path]);
      if (!have.rows.length) throw new Error('Object not found');
      return blobs.get(path)!;
    });
  }

  async subscribe(onRow: (t: 'notebooks' | 'pages', r: Row) => void, onStatus: (s: 'up' | 'down') => void) {
    this.rows.push(onRow);
    this.status.push(onStatus);
    return () => {
      this.rows = this.rows.filter((f) => f !== onRow);
      this.status = this.status.filter((f) => f !== onStatus);
    };
  }
  /** What Supabase Realtime would push after a write. */
  emitRow = (table: 'notebooks' | 'pages', row: Row) => this.rows.forEach((f) => f(table, row));
  emitStatus = (s: 'up' | 'down') => this.status.forEach((f) => f(s));
}

// ---------- fixtures ----------

let db: PGlite;
const rid = (p: string) => p + ulid().slice(0, 26);
const iso = (n: number) => new Date(Date.UTC(2026, 10, 9, 14, 0, 0) + n * 1000).toISOString();
const blk = (id: string, text: string, at: number, extra: Partial<Block> = {}): Block => ({
  id, x: 10, y: 10, text, style: 'normal', ink: 'black', updatedAt: iso(at), deleted: false, ...extra,
});
const page = (id: string, blocks: Block[], at: number, extra: Partial<Page> = {}): Page => ({
  schema: 1, id, title: 'T', paper: 'ruled', tags: [], updatedAt: iso(at), blocks, images: [], ...extra,
});
const notebook = (id: string, extra: Partial<Notebook> = {}): Notebook => ({
  schema: 1, id, name: 'Notebook', paper: 'ruled', font: 'caveat', fontSize: 24, ink: 'blue', margin: true, pageOrder: [], updatedAt: iso(0), ...extra,
});
const device = (uid = ALICE) => {
  const remote = new PgRemote(db, uid);
  return { remote, store: new SupabaseStore(remote) };
};
const b64 = (s: string) => btoa(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await newDb();
}, 60_000);

describe('notebooks', () => {
  it('round-trips through the server in the app’s shape', async () => {
    const { store } = device();
    const id = rid('nb_');
    await store.saveNotebook(notebook(id, { name: 'TAOCP', fontSize: 30, font: 'kalam', ink: 'red', margin: false, pageOrder: ['pg_a', 'pg_b'], updatedAt: iso(7) }));
    const nb = (await store.listNotebooks()).find((n) => n.id === id)!;
    expect(nb).toEqual({ schema: 1, id, name: 'TAOCP', paper: 'ruled', font: 'kalam', fontSize: 30, ink: 'red', margin: false, pageOrder: ['pg_a', 'pg_b'], updatedAt: iso(7) });
  });

  it('soft-deletes, keeping a tombstone', async () => {
    const { store } = device();
    const id = rid('nb_');
    await store.saveNotebook(notebook(id));
    await store.deleteNotebook(id);
    const nb = (await store.listNotebooks()).find((n) => n.id === id)!;
    expect(nb.deleted).toBe(true);
  });

  it('does not show one user’s notebooks to another', async () => {
    const alice = device(ALICE).store;
    const id = rid('nb_');
    await alice.saveNotebook(notebook(id));
    expect((await device(BOB).store.listNotebooks()).find((n) => n.id === id)).toBeUndefined();
  });
});

describe('pages', () => {
  const nb = rid('nb_');
  beforeAll(async () => void (await device().store.saveNotebook(notebook(nb))));

  it('lists the pages of a notebook in the app’s shape', async () => {
    const { store } = device();
    const id = rid('pg_');
    await store.savePage(nb, page(id, [blk('a', 'hello', 1)], 5, { title: 'Ch 1', tags: ['taocp'], paper: 'dots' }));
    const found = (await store.listPages(nb)).find((p) => p.id === id)!;
    expect(found).toEqual({ schema: 1, id, title: 'Ch 1', paper: 'dots', tags: ['taocp'], updatedAt: iso(5), blocks: [blk('a', 'hello', 1)], images: [] });
  });

  it('reports no change when the server holds exactly what we saved (key order does not matter)', async () => {
    const { store } = device();
    const p = page(rid('pg_'), [blk('a', 'x', 1), blk('b', 'y', 2, { ref: { pdf: 'a'.repeat(32), page: 52 } })], 3);
    expect(await store.savePage(nb, p)).toBeNull();
    expect(await store.savePage(nb, p)).toBeNull(); // saving again is a no-op
  });

  it('merges in what another device wrote, instead of overwriting it', async () => {
    const mac = device().store;
    const linux = device().store;
    const id = rid('pg_');
    await mac.savePage(nb, page(id, [blk('a', 'a0', 1)], 1));
    await linux.savePage(nb, page(id, [blk('a', 'a0', 1), blk('from-linux', 'typed on linux', 6)], 6));
    // the Mac has not seen the Linux block yet and saves its own edit
    const merged = await mac.savePage(nb, page(id, [blk('a', 'a-mac', 7)], 7));
    expect(merged).not.toBeNull();
    expect(merged!.blocks.map((b) => b.id).sort()).toEqual(['a', 'from-linux']);
    expect(merged!.blocks.find((b) => b.id === 'a')!.text).toBe('a-mac');
    expect((await mac.listPages(nb)).find((p) => p.id === id)!.blocks).toHaveLength(2);
  });

  it('drops tombstones older than 30 days when listing', async () => {
    const { store } = device();
    const old = new Date(Date.now() - 40 * 86400_000).toISOString();
    const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
    const id = rid('pg_');
    const dead = rid('pg_');
    await store.savePage(nb, { ...page(id, [], 1), updatedAt: recent, blocks: [blk('gone', 'x', 1, { deleted: true, updatedAt: old }), blk('kept', 'x', 1, { deleted: true, updatedAt: recent })] });
    await store.savePage(nb, { ...page(dead, [], 1), updatedAt: old, deleted: true });
    const pages = await store.listPages(nb);
    expect(pages.find((p) => p.id === id)!.blocks.map((b) => b.id)).toEqual(['kept']);
    expect(pages.find((p) => p.id === dead)).toBeUndefined();
  });

  it('keeps users apart', async () => {
    const id = rid('pg_');
    await device(ALICE).store.savePage(nb, page(id, [blk('a', 'private', 1)], 1));
    expect(await device(BOB).store.listPages(nb)).toEqual([]);
    await expect(device(BOB).store.savePage(nb, page(rid('pg_'), [], 1))).rejects.toThrow(/foreign key/);
  });

  it('refuses a malformed notebook id before touching the network', async () => {
    await expect(device().store.savePage('../../etc', page(rid('pg_'), [], 1))).rejects.toThrow(/Invalid notebook id/);
  });
});

describe('PDF registry', () => {
  it('unions what two devices registered and stores only hash + name', async () => {
    const a = device().store;
    const b = device().store;
    const h1 = 'a'.repeat(32);
    const h2 = 'b'.repeat(32);
    await a.saveLibrary({ schema: 1, createdAt: 'x', pdfs: { [h1]: { name: 'TAOCP vol 1.pdf' } } });
    const merged = await b.saveLibrary({ schema: 1, createdAt: 'x', pdfs: { [h2]: { name: 'Concrete Math.pdf' } } });
    expect(Object.keys(merged.pdfs!).sort()).toEqual([h1, h2]);
    expect((await a.loadLibrary()).pdfs![h2]).toEqual({ name: 'Concrete Math.pdf' });
  });
  it('rejects a hash that is not a content hash', async () => {
    await expect(device().store.saveLibrary({ schema: 1, createdAt: 'x', pdfs: { 'not-a-hash': { name: 'x' } } })).rejects.toThrow();
  });
});

describe('assets', () => {
  const nb = rid('nb_');
  it('stores and reads back an image', async () => {
    const { store } = device();
    const name = ulid().slice(0, 26) + '.png';
    await store.writeAsset(nb, name, b64('\u0089PNG fake bytes'));
    const url = await store.readAsset(nb, name);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(atob(url.split(',')[1])).toBe('\u0089PNG fake bytes');
  });
  it('will not let another user read it', async () => {
    const name = ulid().slice(0, 26) + '.jpg';
    await device(ALICE).store.writeAsset(nb, name, b64('private image'));
    await expect(device(BOB).store.readAsset(nb, name)).rejects.toThrow();
  });
  it('rejects path tricks and unexpected file types', async () => {
    const { store } = device();
    for (const bad of ['../x.png', 'a/b.png', 'x.png', ulid().slice(0, 26) + '.svg', ulid().slice(0, 26) + '.png/../../y']) {
      await expect(store.writeAsset(nb, bad, b64('x'))).rejects.toThrow(/Invalid asset name/);
      await expect(store.readAsset(nb, bad)).rejects.toThrow(/Invalid asset name/);
    }
    await expect(store.writeAsset('nb_../..', ulid().slice(0, 26) + '.png', b64('x'))).rejects.toThrow(/Invalid asset name/);
  });
});

describe('live updates', () => {
  it('turns pushed rows into external changes', async () => {
    const { store, remote } = device();
    const other = device().store;
    const nb = rid('nb_');
    await other.saveNotebook(notebook(nb));
    const id = rid('pg_');
    await other.savePage(nb, page(id, [blk('a', 'from the other device', 1)], 4));
    const events: ExternalChange[] = [];
    await store.watch((c) => events.push(c));
    const [row] = (await remote.select('pages', { eq: { id } }));
    remote.emitRow('pages', row);
    await sleep(50);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'page', nbId: nb, conflict: false });
    expect((events[0] as { page: Page }).page.blocks[0].text).toBe('from the other device');
  });

  it('fetches the full row when realtime leaves out the big columns', async () => {
    const { store, remote } = device();
    const other = device().store;
    const nb = rid('nb_');
    await other.saveNotebook(notebook(nb));
    const id = rid('pg_');
    await other.savePage(nb, page(id, [blk('a', 'big', 1)], 4));
    const events: ExternalChange[] = [];
    await store.watch((c) => events.push(c));
    const [row] = await remote.select('pages', { eq: { id } });
    const { blocks, images, ...slim } = row;
    remote.emitRow('pages', slim);
    await sleep(80);
    expect((events[0] as { page: Page }).page.blocks).toHaveLength(1);
  });

  it('catches up on what was missed while disconnected, when the connection comes back', async () => {
    const mine = device();
    const other = device().store;
    const nb = rid('nb_');
    await other.saveNotebook(notebook(nb));
    const seenId = rid('pg_');
    await other.savePage(nb, page(seenId, [blk('a', 'old', 1)], 1));
    await mine.store.listPages(nb); // we have loaded the notebook: this sets our "last heard from the server" mark
    const events: ExternalChange[] = [];
    await mine.store.watch((c) => events.push(c));

    const missed = rid('pg_');
    await other.savePage(nb, page(missed, [blk('b', 'written while we were offline', 9)], 9)); // no realtime event reaches us
    expect(events).toHaveLength(0);
    mine.remote.emitStatus('up'); // reconnected
    await sleep(100);
    const ids = events.map((e) => (e.type === 'page' ? e.page.id : e.notebook.id));
    expect(ids).toContain(missed);
  });

  it('stops delivering after unsubscribing', async () => {
    const { store, remote } = device();
    const events: ExternalChange[] = [];
    const stop = await store.watch((c) => events.push(c));
    stop();
    expect(remote.rows).toHaveLength(0);
  });
});
