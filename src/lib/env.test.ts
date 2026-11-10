import { describe, expect, it } from 'vitest';
import { parseSupabaseEnv, readSupabaseConfig } from './env';

// Fabricated, unsigned tokens: only the payload's `role` claim matters to the parser.
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (role: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role, iss: 'supabase' })}.not-a-real-signature`;

const URL_OK = 'https://abcdefghij.supabase.co';
const env = (key: string, url = URL_OK) => ({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key });

describe('parseSupabaseEnv', () => {
  it('accepts a publishable key', () => {
    expect(parseSupabaseEnv(env('sb_publishable_abc123'))).toEqual({ url: URL_OK, anonKey: 'sb_publishable_abc123' });
  });
  it('accepts a legacy anon JWT', () => {
    const key = jwt('anon');
    expect(parseSupabaseEnv(env(key)).anonKey).toBe(key);
  });
  it('normalises the URL to its origin', () => {
    expect(parseSupabaseEnv(env('sb_publishable_x', URL_OK + '/rest/v1/')).url).toBe(URL_OK);
  });

  it('refuses a service_role JWT', () => {
    expect(() => parseSupabaseEnv(env(jwt('service_role')))).toThrow(/service_role/);
  });
  it('refuses a secret key', () => {
    expect(() => parseSupabaseEnv(env('sb_secret_abc'))).toThrow(/SECRET/);
  });
  it('refuses anything that is not a publishable/anon key', () => {
    expect(() => parseSupabaseEnv(env('hunter2'))).toThrow(/not a publishable/);
    expect(() => parseSupabaseEnv(env(jwt('authenticated')))).toThrow(/not a publishable/);
  });

  it('refuses missing or placeholder values', () => {
    expect(() => parseSupabaseEnv({})).toThrow(/not configured/);
    expect(() => parseSupabaseEnv(env('YOUR-PUBLISHABLE-OR-ANON-KEY', 'https://YOUR-PROJECT-REF.supabase.co'))).toThrow(/placeholder/);
  });
  it('requires https except for a local Supabase', () => {
    expect(() => parseSupabaseEnv(env('sb_publishable_x', 'http://abcdefghij.supabase.co'))).toThrow(/https/);
    expect(parseSupabaseEnv(env('sb_publishable_x', 'http://127.0.0.1:54321')).url).toBe('http://127.0.0.1:54321');
  });
  it('refuses credentials in the URL and garbage URLs', () => {
    expect(() => parseSupabaseEnv(env('sb_publishable_x', 'https://user:pw@abcdefghij.supabase.co'))).toThrow(/credentials/);
    expect(() => parseSupabaseEnv(env('sb_publishable_x', 'not a url'))).toThrow(/valid URL/);
  });
});

describe('readSupabaseConfig', () => {
  it('is unconfigured when empty or still the template placeholders', () => {
    expect(readSupabaseConfig({})).toEqual({ kind: 'unconfigured' });
    expect(readSupabaseConfig(env('YOUR-PUBLISHABLE-OR-ANON-KEY', 'https://YOUR-PROJECT-REF.supabase.co'))).toEqual({ kind: 'unconfigured' });
  });
  it('is ok for a safe configuration', () => {
    expect(readSupabaseConfig(env('sb_publishable_abc'))).toEqual({ kind: 'ok', env: { url: URL_OK, anonKey: 'sb_publishable_abc' } });
  });
  it('is invalid (not silently ignored) when half filled in or unsafe', () => {
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: URL_OK })).toMatchObject({ kind: 'invalid' });
    expect(readSupabaseConfig({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' })).toMatchObject({ kind: 'invalid' });
    expect(readSupabaseConfig(env(jwt('service_role')))).toMatchObject({ kind: 'invalid', message: expect.stringMatching(/service_role/) });
    expect(readSupabaseConfig(env('sb_secret_abc'))).toMatchObject({ kind: 'invalid' });
  });
});
