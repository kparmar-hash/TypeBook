/**
 * Runs the real migration in Postgres (PGlite) and attacks it: row isolation between users, the anon role,
 * constraints, the merge functions (checked against the app's own TypeScript merge), clean-up and storage.
 * Only the Supabase-specific pieces (roles, auth.uid(), the storage schema) are stubbed.
 */
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALICE, BOB, MIGRATION, newDb } from './harness';
import { differs } from '../src/lib/canonical';
import { mergePages } from '../src/lib/merge';
import { scrubBlock, scrubNotebook, scrubPage } from '../src/lib/tombstones';
import { ulid } from '../src/lib/ulid';
import type { Block, Page } from '../src/lib/types';

// TB_MIGRATION lets a mutation check point the suite at a deliberately broken copy of the script.

let db: PGlite;

/** Run `fn` as a signed-in user (or the anon role), exactly as PostgREST would. */
async function as<T>(who: string | 'anon' | 'none', fn: () => Promise<T>): Promise<T> {
  await db.exec(who === 'anon' ? 'set role anon' : 'set role authenticated');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who === 'anon' || who === 'none' ? '' : who]);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected the statement to be rejected, but it succeeded');
};

// ---------- fixtures ----------
const rid = (prefix: string) => prefix + ulid().slice(0, 26);
const T = (n: number) => new Date(Date.UTC(2026, 10, 9, 14, 0, 0) + n * 1000).toISOString();
const blk = (id: string, text: string, at: number, extra: Partial<Block> = {}): Block => ({
  id, x: 10, y: 10, text, style: 'normal', ink: 'black', updatedAt: T(at), deleted: false, ...extra,
});
const mkPage = (id: string, blocks: Block[], at: number, extra: Partial<Page> = {}): Page => ({
  schema: 1, id, title: 'T', paper: 'ruled', tags: [], updatedAt: T(at), blocks, images: [], ...extra,
});
const mkNotebook = (id: string, extra: Record<string, unknown> = {}) => ({
  schema: 1, id, name: 'Notebook', paper: 'ruled', font: 'caveat', fontSize: 24, ink: 'blue', margin: true, pageOrder: [], updatedAt: T(0), ...extra,
});

const saveNb = async (nb: object) => (await db.query<{ r: any }>('select public.save_notebook($1::jsonb) as r', [JSON.stringify(nb)])).rows[0].r;
const savePg = async (nbId: string, page: object) => (await db.query<{ r: any }>('select public.save_page($1, $2::jsonb) as r', [nbId, JSON.stringify(page)])).rows[0].r;
const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*) as n from public.${table}`)).rows[0].n);
const byId = <X extends { id: string }>(xs: X[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

beforeAll(async () => {
  db = await newDb();
}, 60_000);

describe('migration', () => {
  it('is safe to run twice', async () => {
    await db.exec(MIGRATION);
  });

  it('enables and forces row level security on every table', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual(['notebooks', 'pages', 'pdfs']);
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });

  it('gives the anon role no table privileges', async () => {
    const { rows } = await db.query(
      `select grantee, table_name from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`,
    );
    expect(rows).toEqual([]);
  });

  it('makes the private bucket private', async () => {
    const { rows } = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'assets'`);
    expect(rows).toEqual([{ public: false }]);
  });
});

describe('the anon role (public key, not signed in)', () => {
  it('cannot read, write or call anything', async () => {
    await as('anon', async () => {
      expect(await fails(db.query('select * from public.pages'))).toMatch(/permission denied/);
      expect(await fails(db.query('select * from public.notebooks'))).toMatch(/permission denied/);
      expect(await fails(db.query('select * from public.pdfs'))).toMatch(/permission denied/);
      expect(await fails(db.query(`insert into public.pdfs (hash, name) values ('${'a'.repeat(32)}', 'x')`))).toMatch(/permission denied/);
      expect(await fails(savePg('nb_X', {}))).toMatch(/permission denied/);
      expect(await fails(saveNb({}))).toMatch(/permission denied/);
      expect(await fails(db.query('select public.purge_tombstones()'))).toMatch(/permission denied/);
    });
  });
  it('is refused even when pretending to be a user via the claim', async () => {
    await as('anon', async () => {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ALICE]);
      expect(await fails(db.query('select * from public.pages'))).toMatch(/permission denied/);
    });
  });
  it('a signed-in role with no user id is rejected by the functions', async () => {
    await as('none', async () => {
      expect(await fails(saveNb(mkNotebook(rid('nb_'))))).toMatch(/not authenticated/);
      expect(await fails(savePg('x', mkPage(rid('pg_'), [], 1)))).toMatch(/not authenticated/);
    });
  });
});

describe('isolation between signed-in users', () => {
  const nbId = rid('nb_');
  const pgId = rid('pg_');

  beforeAll(async () => {
    await as(ALICE, async () => {
      await saveNb(mkNotebook(nbId, { name: "Alice's notebook" }));
      await savePg(nbId, mkPage(pgId, [blk('b1', 'alice secret', 1)], 1, { title: 'private' }));
      await db.query(`insert into public.pdfs (hash, name) values ('${'b'.repeat(32)}', 'alice.pdf')`);
    });
  });

  it("Bob cannot see any of Alice's rows", async () => {
    await as(BOB, async () => {
      expect(await count('notebooks')).toBe(0);
      expect(await count('pages')).toBe(0);
      expect(await count('pdfs')).toBe(0);
    });
    await as(ALICE, async () => expect(await count('pages')).toBeGreaterThanOrEqual(1));
  });

  it("Bob cannot change or delete Alice's rows", async () => {
    await as(BOB, async () => {
      expect((await db.query(`update public.pages set title = 'pwned' where id = $1`, [pgId])).affectedRows).toBe(0);
      expect((await db.query(`delete from public.pages where id = $1`, [pgId])).affectedRows).toBe(0);
      expect((await db.query(`update public.notebooks set name = 'pwned' where id = $1`, [nbId])).affectedRows).toBe(0);
      expect((await db.query(`delete from public.notebooks where id = $1`, [nbId])).affectedRows).toBe(0);
      expect((await db.query(`delete from public.pdfs where hash = $1`, ['b'.repeat(32)])).affectedRows).toBe(0);
    });
    await as(ALICE, async () => {
      const { rows } = await db.query<{ title: string }>('select title from public.pages where id = $1', [pgId]);
      expect(rows[0].title).toBe('private');
    });
  });

  it('Bob cannot write rows as Alice, or attach his page to her notebook', async () => {
    await as(BOB, async () => {
      expect(await fails(db.query(`insert into public.notebooks (user_id, id, name) values ($1, $2, 'x')`, [ALICE, rid('nb_')]))).toMatch(/row-level security/);
      expect(await fails(db.query(`insert into public.pdfs (user_id, hash, name) values ($1, $2, 'x')`, [ALICE, 'c'.repeat(32)]))).toMatch(/row-level security/);
      expect(await fails(savePg(nbId, mkPage(rid('pg_'), [], 1)))).toMatch(/foreign key/);
      expect(await fails(db.query(`insert into public.pages (user_id, id, notebook_id) values ($1, $2, $3)`, [ALICE, rid('pg_'), nbId]))).toMatch(/row-level security/);
    });
  });

  it("Bob saving a page with Alice's page id creates his own separate copy, not hers", async () => {
    const bobNb = rid('nb_');
    await as(BOB, async () => {
      await saveNb(mkNotebook(bobNb));
      const out = await savePg(bobNb, mkPage(pgId, [blk('b9', 'bob text', 5)], 5, { title: 'bobs' }));
      expect(out.blocks).toHaveLength(1);
      expect(out.title).toBe('bobs');
    });
    await as(ALICE, async () => {
      const { rows } = await db.query<{ title: string; blocks: Block[] }>('select title, blocks from public.pages where id = $1', [pgId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('private');
      expect(rows[0].blocks.map((b) => b.id)).toEqual(['b1']);
    });
  });

  it('a user cannot hand a row to someone else or rename its identity', async () => {
    await as(ALICE, async () => {
      expect(await fails(db.query(`update public.pages set user_id = $1 where id = $2`, [BOB, pgId]))).toMatch(/row-level security|cannot be changed/);
      expect(await fails(db.query(`update public.pages set id = $1 where id = $2`, [rid('pg_'), pgId]))).toMatch(/cannot be changed/);
      expect(await fails(db.query(`update public.pages set notebook_id = $1 where id = $2`, [rid('nb_'), pgId]))).toMatch(/move|foreign key/);
    });
  });
});

describe('constraints', () => {
  it('reject malformed data', async () => {
    await as(ALICE, async () => {
      expect(await fails(saveNb(mkNotebook('nb_short')))).toMatch(/invalid notebook id/);
      expect(await fails(saveNb(mkNotebook(rid('nb_'), { font: 'comic-sans' })))).toMatch(/check constraint/);
      expect(await fails(saveNb(mkNotebook(rid('nb_'), { fontSize: 5000 })))).toMatch(/check constraint/);
      expect(await fails(saveNb(mkNotebook(rid('nb_'), { name: '' })))).toMatch(/check constraint/);
      expect(await fails(saveNb(mkNotebook(rid('nb_'), { pageOrder: 'nope' })))).toMatch(/array/);
      expect(await fails(savePg('x', mkPage('pg_bad', [], 1)))).toMatch(/invalid page id/);
      expect(await fails(savePg('x', { id: rid('pg_'), blocks: 'x', updatedAt: T(1) }))).toMatch(/arrays/);
      expect(await fails(savePg('x', { id: rid('pg_') }))).toMatch(/updatedAt is required/);
      expect(await fails(db.query(`insert into public.pdfs (hash, name) values ('not-a-hash', 'x')`))).toMatch(/check constraint/);
    });
  });

  it('cap the size of a page', async () => {
    const nb = rid('nb_');
    await as(ALICE, async () => {
      await saveNb(mkNotebook(nb));
      const huge = 'x'.repeat(8_100_000);
      expect(await fails(savePg(nb, mkPage(rid('pg_'), [blk('b', huge, 1)], 1)))).toMatch(/check constraint/);
    });
  }, 60_000);

  it('clamp an updatedAt far in the future so it cannot win every merge forever', async () => {
    const nb = rid('nb_');
    await as(ALICE, async () => {
      await saveNb(mkNotebook(nb));
      const out = await savePg(nb, mkPage(rid('pg_'), [], 1, { updatedAt: '2999-01-01T00:00:00.000Z' }));
      expect(out.updatedAt < '2100').toBe(true);
    });
  });
});

describe('save_page merges like the app does', () => {
  const nb = rid('nb_');
  beforeAll(async () => {
    await as(ALICE, async () => void (await saveNb(mkNotebook(nb))));
  });
  const fresh = () => rid('pg_');
  const get = (page: Page, id: string) => page.blocks.find((b) => b.id === id)!;

  it('returns the page in the app JSON shape', async () => {
    const id = fresh();
    await as(ALICE, async () => {
      const out = await savePg(nb, mkPage(id, [blk('a', 'x', 1)], 3, { title: 'Ch 1', tags: ['taocp'], paper: 'dots' }));
      expect(out).toMatchObject({ schema: 1, id, title: 'Ch 1', tags: ['taocp'], paper: 'dots', updatedAt: T(3) });
      expect(out.blocks).toEqual([blk('a', 'x', 1)]);
      expect(out.images).toEqual([]);
      expect(out).not.toHaveProperty('deleted');
    });
  });

  it('keeps edits to different blocks from two devices', async () => {
    const id = fresh();
    await as(ALICE, async () => {
      await savePg(nb, mkPage(id, [blk('a', 'a-mac', 5), blk('b', 'b0', 1)], 5));
      const out = await savePg(nb, mkPage(id, [blk('a', 'a0', 1), blk('b', 'b-linux', 6)], 6));
      expect(get(out, 'a').text).toBe('a-mac');
      expect(get(out, 'b').text).toBe('b-linux');
    });
  });

  it('lets the newer edit win on the same block, whichever device saves last', async () => {
    const id = fresh();
    await as(ALICE, async () => {
      await savePg(nb, mkPage(id, [blk('a', 'newer', 9)], 9));
      const out = await savePg(nb, mkPage(id, [blk('a', 'older', 4)], 4)); // arrives later but is older
      expect(get(out, 'a').text).toBe('newer');
      expect(out.updatedAt).toBe(T(9));
    });
  });

  it('delete vs edit: a newer tombstone wins, a newer edit wins, a tie goes to the tombstone', async () => {
    await as(ALICE, async () => {
      const a = fresh();
      await savePg(nb, mkPage(a, [blk('x', 'edited', 5)], 5));
      expect(get(await savePg(nb, mkPage(a, [blk('x', 'orig', 8, { deleted: true })], 8)), 'x').deleted).toBe(true);

      const b = fresh();
      await savePg(nb, mkPage(b, [blk('x', 'orig', 5, { deleted: true })], 5));
      const out = await savePg(nb, mkPage(b, [blk('x', 'edited', 8)], 8));
      expect(get(out, 'x')).toMatchObject({ deleted: false, text: 'edited' });

      const c = fresh();
      await savePg(nb, mkPage(c, [blk('x', 'x', 5)], 5));
      expect(get(await savePg(nb, mkPage(c, [blk('x', 'x', 5, { deleted: true })], 5)), 'x').deleted).toBe(true);
    });
  });

  it('does not resurrect a block a stale device still has', async () => {
    const id = fresh();
    await as(ALICE, async () => {
      await savePg(nb, mkPage(id, [blk('a', 'gone', 6, { deleted: true })], 6));
      const out = await savePg(nb, mkPage(id, [blk('a', 'gone', 1)], 1));
      expect(get(out, 'a').deleted).toBe(true);
    });
  });

  it('page-level fields come from the newer page; images merge too', async () => {
    const id = fresh();
    const img = (n: string, at: number, size = 'm') => ({ id: n, x: 0, y: 0, size, asset: `${n}.png`, updatedAt: T(at), deleted: false });
    await as(ALICE, async () => {
      await savePg(nb, mkPage(id, [], 9, { title: 'new', tags: ['y'], paper: 'dots', images: [img('i1', 2), img('i2', 3)] }));
      const out = await savePg(nb, mkPage(id, [], 4, { title: 'old', tags: ['x'], paper: 'ruled', images: [img('i1', 5, 'l'), img('i3', 4)] }));
      expect(out).toMatchObject({ title: 'new', tags: ['y'], paper: 'dots', updatedAt: T(9) });
      expect(byId(out.images).map((i: any) => [i.id, i.size])).toEqual([['i1', 'l'], ['i2', 'm'], ['i3', 'm']]);
    });
  });

  it('a newer page tombstone wins', async () => {
    const id = fresh();
    await as(ALICE, async () => {
      await savePg(nb, mkPage(id, [], 5));
      expect((await savePg(nb, mkPage(id, [], 9, { deleted: true }))).deleted).toBe(true);
    });
  });

  it('saving the same page twice changes nothing', async () => {
    const id = fresh();
    const p = mkPage(id, [blk('a', 'x', 1), blk('b', 'y', 2)], 3);
    await as(ALICE, async () => {
      const first = await savePg(nb, p);
      const second = await savePg(nb, p);
      expect(second).toEqual(first);
    });
  });

  it('refuses to move a page to another notebook', async () => {
    const id = fresh();
    const other = rid('nb_');
    await as(ALICE, async () => {
      await saveNb(mkNotebook(other));
      await savePg(nb, mkPage(id, [], 1));
      expect(await fails(savePg(other, mkPage(id, [], 2)))).toMatch(/different notebook/);
    });
  });

  it('agrees with the app’s TypeScript merge on random edits', async () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const randomPage = (id: string, clock: { n: number }) => {
      const blocks = ids.filter(() => rnd() < 0.6).map((bid) => blk(bid, `t${Math.floor(rnd() * 1000)}`, ++clock.n, { deleted: rnd() < 0.2 }));
      return mkPage(id, blocks, ++clock.n, { title: `title${Math.floor(rnd() * 100)}`, tags: rnd() < 0.5 ? ['x'] : ['y', 'z'], paper: rnd() < 0.5 ? 'dots' : 'grid' });
    };
    await as(ALICE, async () => {
      for (let i = 0; i < 40; i++) {
        const id = fresh();
        const clock = { n: 1 }; // every timestamp is distinct, so no tie-break ambiguity
        const a = randomPage(id, clock);
        const b = randomPage(id, clock);
        await savePg(nb, a);
        const sql = await savePg(nb, b);
        const ts = mergePages(a, b);
        expect(byId(sql.blocks)).toEqual(byId(ts.blocks.map(scrubBlock))); // the server empties deleted blocks
        expect({ title: sql.title, tags: sql.tags, paper: sql.paper, updatedAt: sql.updatedAt }).toEqual({ title: ts.title, tags: ts.tags, paper: ts.paper, updatedAt: ts.updatedAt });
      }
    });
  }, 120_000);
});

describe('save_notebook', () => {
  it('newest settings win and page order keeps pages only the other side knows', async () => {
    const id = rid('nb_');
    await as(ALICE, async () => {
      await saveNb(mkNotebook(id, { name: 'old', pageOrder: ['p1', 'p2'], updatedAt: T(5) }));
      const out = await saveNb(mkNotebook(id, { name: 'new', fontSize: 30, pageOrder: ['p2', 'p3'], updatedAt: T(9) }));
      expect(out).toMatchObject({ id, name: 'new', fontSize: 30, pageOrder: ['p2', 'p3', 'p1'], updatedAt: T(9) });
    });
  });
  it('an older save does not overwrite newer settings', async () => {
    const id = rid('nb_');
    await as(ALICE, async () => {
      await saveNb(mkNotebook(id, { name: 'newer', updatedAt: T(9) }));
      const out = await saveNb(mkNotebook(id, { name: 'stale', updatedAt: T(2), pageOrder: ['p7'] }));
      expect(out.name).toBe('newer');
      expect(out.pageOrder).toEqual(['p7']);
    });
  });
});

describe('purge_tombstones', () => {
  it('removes only the caller’s old tombstones', async () => {
    const nb = rid('nb_');
    const pg = rid('pg_');
    const old = new Date(Date.now() - 40 * 86400_000).toISOString();
    const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
    const deadPage = rid('pg_');
    await as(ALICE, async () => {
      await saveNb(mkNotebook(nb));
      await savePg(nb, { ...mkPage(pg, [], 1), updatedAt: recent, blocks: [
        blk('keep', 'live', 1, { updatedAt: old }),
        blk('old-dead', 'x', 1, { deleted: true, updatedAt: old }),
        blk('new-dead', 'x', 1, { deleted: true, updatedAt: recent }),
      ] });
      await savePg(nb, { ...mkPage(deadPage, [], 1), updatedAt: old, deleted: true });
    });
    await as(BOB, async () => void (await db.query('select public.purge_tombstones()')));
    await as(ALICE, async () => expect(await count('pages')).toBeGreaterThanOrEqual(2)); // Bob's purge touched nothing of hers

    await as(ALICE, async () => {
      await db.query('select public.purge_tombstones()');
      const { rows } = await db.query<{ blocks: Block[] }>('select blocks from public.pages where id = $1', [pg]);
      expect(rows[0].blocks.map((b) => b.id).sort()).toEqual(['keep', 'new-dead']);
      const gone = await db.query('select 1 from public.pages where id = $1', [deadPage]);
      expect(gone.rows).toHaveLength(0);
    });
  });
});

describe('storage policies for pasted images', () => {
  const put = (bucket: string, name: string) => db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]);

  it('lets a user store and read objects only inside their own folder', async () => {
    await as(ALICE, async () => {
      await put('assets', `${ALICE}/nb_1/pic.png`);
      expect((await db.query('select name from storage.objects')).rows).toHaveLength(1);
      expect(await fails(put('assets', `${BOB}/nb_1/pic.png`))).toMatch(/row-level security/);
      expect(await fails(put('assets', `loose-file.png`))).toMatch(/row-level security/);
      expect(await fails(put('other-bucket', `${ALICE}/x.png`))).toMatch(/row-level security/);
    });
  });
  it('hides one user’s objects from another and from anon', async () => {
    await as(BOB, async () => {
      expect((await db.query('select name from storage.objects')).rows).toHaveLength(0);
      expect((await db.query(`delete from storage.objects where name like '%pic.png'`)).affectedRows).toBe(0);
      expect((await db.query(`update storage.objects set name = '${BOB}/stolen.png'`)).affectedRows).toBe(0);
    });
    await as('anon', async () => expect(await fails(db.query('select * from storage.objects'))).toMatch(/permission denied/));
  });
  it('does not let a user move an object into someone else’s folder', async () => {
    await as(ALICE, async () => {
      expect(await fails(db.query(`update storage.objects set name = '${BOB}/moved.png'`))).toMatch(/row-level security/);
    });
  });
});

describe('deleting empties the content (the row stays as a bare tombstone)', () => {
  const nb = rid('nb_');
  beforeAll(async () => {
    await as(ALICE, async () => void (await saveNb(mkNotebook(nb, { name: 'Thesis' }))));
  });
  const rowOf = async (id: string) => (await db.query<any>('select title, tags, blocks, images, deleted from public.pages where id = $1', [id])).rows[0];
  const img = (n: string, at: number) => ({ id: n, x: 0, y: 0, size: 'm', asset: `${n}.png`, updatedAt: T(at), deleted: false });
  const full = (id: string, at: number, extra: Partial<Page> = {}) =>
    mkPage(id, [blk('a', 'my private notes', 1), blk('b', 'more', 1, { ref: { pdf: 'h'.repeat(32), page: 3 } })], at, { title: 'Chapter 7', tags: ['secret'], images: [img('i1', 1)] as any, ...extra });

  it('a deleted page keeps only its identity and timestamps', async () => {
    const id = rid('pg_');
    await as(ALICE, async () => {
      await savePg(nb, full(id, 3));
      const out = await savePg(nb, full(id, 8, { deleted: true }));
      expect(out).toMatchObject({ deleted: true, title: '', tags: [], blocks: [], images: [], updatedAt: T(8) });
      expect(await rowOf(id)).toEqual({ title: '', tags: [], blocks: [], images: [], deleted: true });
      expect(differs(out, scrubPage(full(id, 8, { deleted: true })))).toBe(false); // the app predicts it exactly
    });
  });

  it('an offline device cannot bring the deleted content back by saving its old copy', async () => {
    const id = rid('pg_');
    await as(ALICE, async () => {
      await savePg(nb, full(id, 3));
      await savePg(nb, full(id, 8, { deleted: true }));
      const out = await savePg(nb, full(id, 5)); // stale device with the old content
      expect(out).toMatchObject({ deleted: true, title: '', blocks: [] });
      expect(await rowOf(id)).toMatchObject({ title: '', deleted: true, blocks: [] });
    });
  });

  it('Undo works: re-sending the content with a newer time restores the page', async () => {
    const id = rid('pg_');
    await as(ALICE, async () => {
      await savePg(nb, full(id, 3));
      await savePg(nb, full(id, 8, { deleted: true }));
      const out = await savePg(nb, full(id, 12)); // the deleting device undoes: not deleted, newer, still has its content
      expect(out.deleted).toBeUndefined();
      expect(out).toMatchObject({ title: 'Chapter 7', tags: ['secret'] });
      expect(out.blocks.map((b: Block) => b.text).sort()).toEqual(['more', 'my private notes']);
      expect(out.images).toHaveLength(1);
    });
  });

  it('a deleted block loses its text and PDF link but keeps what merging needs', async () => {
    const id = rid('pg_');
    await as(ALICE, async () => {
      await savePg(nb, mkPage(id, [blk('keep', 'live text', 1), blk('gone', 'secret text', 2, { ref: { pdf: 'h'.repeat(32), page: 9 } })], 3));
      const out = await savePg(nb, mkPage(id, [blk('gone', 'secret text', 6, { deleted: true, ref: { pdf: 'h'.repeat(32), page: 9 } })], 6));
      const gone = out.blocks.find((b: Block) => b.id === 'gone');
      expect(gone).toEqual({ id: 'gone', x: 10, y: 10, text: '', style: 'normal', ink: 'black', updatedAt: T(6), deleted: true });
      expect(out.blocks.find((b: Block) => b.id === 'keep').text).toBe('live text');
      // Undo of a block delete: the same block, newer, live, with its text
      const back = await savePg(nb, mkPage(id, [blk('gone', 'secret text', 9, { ref: { pdf: 'h'.repeat(32), page: 9 } })], 9));
      expect(back.blocks.find((b: Block) => b.id === 'gone')).toMatchObject({ text: 'secret text', deleted: false, ref: { page: 9 } });
    });
  });

  it('deleting a notebook empties its name, its page order and every page in it, and nothing else', async () => {
    const doomed = rid('nb_');
    const other = rid('nb_');
    const p1 = rid('pg_');
    const p2 = rid('pg_');
    const keep = rid('pg_');
    await as(ALICE, async () => {
      await saveNb(mkNotebook(doomed, { name: 'My thesis', pageOrder: [p1, p2], updatedAt: T(2) }));
      await saveNb(mkNotebook(other, { name: 'Groceries' }));
      await savePg(doomed, full(p1, 3));
      await savePg(doomed, full(p2, 3));
      await savePg(other, full(keep, 3));
      const out = await saveNb(mkNotebook(doomed, { name: 'My thesis', pageOrder: [p1, p2], deleted: true, updatedAt: T(9) }));
      expect(out).toMatchObject({ name: 'Deleted notebook', pageOrder: [], deleted: true });
      expect(differs(out, scrubNotebook(mkNotebook(doomed, { name: 'My thesis', pageOrder: [p1, p2], deleted: true, updatedAt: T(9) } as any)))).toBe(false);
      for (const id of [p1, p2]) expect(await rowOf(id)).toEqual({ title: '', tags: [], blocks: [], images: [], deleted: true });
      expect(await rowOf(keep)).toMatchObject({ title: 'Chapter 7', deleted: false });
      const { rows } = await db.query<any>('select name from public.notebooks where id = $1', [other]);
      expect(rows[0].name).toBe('Groceries');

      // Undo: the app restores the notebook, then re-sends its pages with a newer time
      const restored = await saveNb(mkNotebook(doomed, { name: 'My thesis', pageOrder: [p1, p2], updatedAt: T(14) }));
      expect(restored).toMatchObject({ name: 'My thesis', pageOrder: [p1, p2] });
      const page = await savePg(doomed, full(p1, 14));
      expect(page.title).toBe('Chapter 7');
      expect(page.blocks).toHaveLength(2);
    });
  });

  it('cleans up what was deleted before the migration existed', async () => {
    const nbDead = rid('nb_');
    const nbLive = rid('nb_');
    const pDead = rid('pg_');
    const pInDeadNb = rid('pg_');
    const pLive = rid('pg_');
    // the way old rows looked: full content kept inside tombstones (inserted as the admin role, bypassing RLS)
    await db.exec(`
      insert into public.notebooks (user_id, id, name, page_order, deleted, updated_at) values
        ('${ALICE}', '${nbDead}', 'Old thesis', '{${pInDeadNb}}', true, now()),
        ('${ALICE}', '${nbLive}', 'Live notebook', '{}', false, now());
      insert into public.pages (user_id, id, notebook_id, title, tags, blocks, images, deleted, updated_at) values
        ('${ALICE}', '${pDead}', '${nbLive}', 'Deleted page', '{x}', '[{"id":"a","text":"old secret","updatedAt":"2026-01-01T00:00:00.000Z","deleted":false}]', '[{"id":"i","asset":"a.png","updatedAt":"2026-01-01T00:00:00.000Z","deleted":false}]', true, now()),
        ('${ALICE}', '${pInDeadNb}', '${nbDead}', 'In deleted notebook', '{y}', '[{"id":"a","text":"also secret","updatedAt":"2026-01-01T00:00:00.000Z","deleted":false}]', '[]', false, now()),
        ('${ALICE}', '${pLive}', '${nbLive}', 'Live page', '{z}',
          '[{"id":"keep","text":"stays","updatedAt":"2026-01-01T00:00:00.000Z","deleted":false},{"id":"dead","text":"old block secret","ref":{"pdf":"h","page":1},"updatedAt":"2026-01-01T00:00:00.000Z","deleted":true}]', '[]', false, now());
    `);
    for (const sql of [MIGRATION]) await db.exec(sql); // run the migrations again, as a user upgrading would
    expect(await rowOf(pDead)).toEqual({ title: '', tags: [], blocks: [], images: [], deleted: true });
    expect(await rowOf(pInDeadNb)).toEqual({ title: '', tags: [], blocks: [], images: [], deleted: true });
    const live = await rowOf(pLive);
    expect(live.title).toBe('Live page');
    expect(live.blocks.find((b: Block) => b.id === 'keep').text).toBe('stays');
    expect(live.blocks.find((b: Block) => b.id === 'dead')).toEqual({ id: 'dead', text: '', updatedAt: '2026-01-01T00:00:00.000Z', deleted: true });
    const nbs = await db.query<any>('select id, name, page_order from public.notebooks where id = any($1)', [[nbDead, nbLive]]);
    expect(nbs.rows.find((r: any) => r.id === nbDead)).toMatchObject({ name: 'Deleted notebook', page_order: [] });
    expect(nbs.rows.find((r: any) => r.id === nbLive).name).toBe('Live notebook');
    await db.exec('reset role');
  });
});
