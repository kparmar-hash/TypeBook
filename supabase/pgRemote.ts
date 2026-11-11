import type { PGlite } from '@electric-sql/pglite';
import type { Remote, Row, Table } from '../src/lib/supabaseStore';

const locks = new WeakMap<PGlite, Promise<unknown>>();
export const blobs = new Map<string, Uint8Array>();

export class PgRemote implements Remote {
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

