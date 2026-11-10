import type { SupabaseClient } from '@supabase/supabase-js';
import type { Remote, Row, Table } from './supabaseStore';

const PAGE_SIZE = 500; // PostgREST returns at most 1000 rows per request; page through to be safe

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** `Remote` backed by supabase-js. Everything here runs as the signed-in user, subject to Row Level Security. */
export function createSupabaseRemote(client: SupabaseClient, userId: string): Remote {
  return {
    userId: () => userId,

    async rpc(fn, args) {
      return must(await client.rpc(fn, args));
    },

    async select(table: Table, q = {}) {
      const out: Row[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        let b = client
          .from(table)
          .select('*')
          .order(table === 'pdfs' ? 'hash' : 'id')
          .range(from, from + PAGE_SIZE - 1);
        for (const [k, v] of Object.entries(q.eq ?? {})) b = b.eq(k, v);
        for (const [k, v] of Object.entries(q.gt ?? {})) b = b.gt(k, v);
        const rows = must(await b) as Row[];
        out.push(...rows);
        if (rows.length < PAGE_SIZE) return out;
      }
    },

    async insertPdfs(rows) {
      must(
        await client
          .from('pdfs')
          .upsert(rows.map((r) => ({ user_id: userId, ...r })), { onConflict: 'user_id,hash', ignoreDuplicates: true }),
      );
    },

    async upload(path, bytes, contentType) {
      const { error } = await client.storage.from('assets').upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(error.message);
    },

    async download(path) {
      const { data, error } = await client.storage.from('assets').download(path);
      if (error || !data) throw new Error(error?.message ?? 'Image not found');
      return new Uint8Array(await data.arrayBuffer());
    },

    async subscribe(onRow, onStatus) {
      const channel = client.channel(`typebook-${userId}`);
      for (const table of ['pages', 'notebooks'] as const) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, (p) => {
          if (p.eventType !== 'DELETE') onRow(table, p.new as Row);
        });
      }
      channel.subscribe((status) => onStatus(status === 'SUBSCRIBED' ? 'up' : 'down'));
      return () => void client.removeChannel(channel);
    },
  };
}
