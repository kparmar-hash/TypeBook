import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('./migrations/', import.meta.url);
/** Every migration, in order, exactly as you would run them in the SQL editor. */
export const MIGRATIONS = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(f, DIR), 'utf8'));
export const MIGRATION = MIGRATIONS.join('\n');

export const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  create publication supabase_realtime;
`;

export const ALICE = '11111111-1111-1111-1111-111111111111';
export const BOB = '22222222-2222-2222-2222-222222222222';


/** A fresh Postgres with the Supabase stubs, two users, and the real migration applied. */
export async function newDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(`insert into auth.users (id) values ('${ALICE}'), ('${BOB}')`);
  await db.exec(MIGRATION);
  return db;
}
