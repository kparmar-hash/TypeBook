/**
 * Reads and validates the Supabase settings from the Vite environment.
 *
 * The app only ever holds the PUBLIC key. If someone pastes a privileged key (service_role / sb_secret_)
 * into `.env`, refuse to start rather than ship it inside the bundle.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

interface RawEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** Decode a JWT payload without verifying it (only to read the `role` claim). */
function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

const isLocalHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

export function parseSupabaseEnv(env: RawEnv): SupabaseEnv {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error('Supabase is not configured: copy .env.example to .env and fill in both values.');
  if (/YOUR-/i.test(url) || /YOUR-/i.test(key)) throw new Error('.env still contains the placeholder values from .env.example.');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('VITE_SUPABASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost(parsed.hostname)))
    throw new Error('VITE_SUPABASE_URL must use https (http is only allowed for a local Supabase).');
  if (parsed.username || parsed.password) throw new Error('VITE_SUPABASE_URL must not contain credentials.');

  if (key.startsWith('sb_secret_')) throw new Error('VITE_SUPABASE_ANON_KEY holds a SECRET key. Use the publishable key; secret keys must never be in the app.');
  if (!key.startsWith('sb_publishable_')) {
    const role = jwtRole(key);
    if (role === 'service_role') throw new Error('VITE_SUPABASE_ANON_KEY holds the service_role key, which bypasses all security. Use the anon/publishable key.');
    if (role !== 'anon') throw new Error('VITE_SUPABASE_ANON_KEY is not a publishable/anon key.');
  }
  return { url: parsed.origin, anonKey: key };
}

/** Validated settings for this build. Throws a readable error if `.env` is missing or unsafe. */
export const supabaseEnv = (): SupabaseEnv => parseSupabaseEnv(import.meta.env);

export type SupabaseConfig =
  | { kind: 'unconfigured' }
  | { kind: 'ok'; env: SupabaseEnv }
  | { kind: 'invalid'; message: string };

/**
 * Decide how the app should behave:
 *  - nothing filled in (or still the template placeholders): `unconfigured`, run without Supabase;
 *  - filled in and safe: `ok`;
 *  - filled in but wrong or unsafe (e.g. a service_role key): `invalid`, and the app must refuse to start.
 * Half-configured or unsafe settings are never silently ignored.
 */
export function readSupabaseConfig(env: RawEnv): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL?.trim() ?? '';
  const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  const blank = (v: string) => !v || /YOUR-/i.test(v);
  if (blank(url) && blank(key)) return { kind: 'unconfigured' };
  try {
    return { kind: 'ok', env: parseSupabaseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key }) };
  } catch (e) {
    return { kind: 'invalid', message: e instanceof Error ? e.message : String(e) };
  }
}
