import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { friendlyAuthError, validateCredentials } from './authErrors';
import type { SupabaseEnv } from './env';

/** Reactive state of the sign-in form. The session itself is owned by supabase-js. */
export const auth = $state({ busy: false, error: '', notice: '' });

let client: SupabaseClient | null = null;

/** The one Supabase client for this app. It only ever carries the public key plus the signed-in user's token. */
export function createSupabaseClient(env: SupabaseEnv): SupabaseClient {
  client = createClient(env.url, env.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // a desktop app has no redirect URL to read tokens from
      flowType: 'pkce', // a stolen redirect code is useless without the verifier kept in this app
    },
  });
  return client;
}

export function supabaseClient(): SupabaseClient {
  if (!client) throw new Error('Supabase is not initialised');
  return client;
}

async function guarded(action: () => Promise<void>) {
  auth.busy = true;
  auth.error = '';
  auth.notice = '';
  try {
    await action();
  } catch (e) {
    auth.error = friendlyAuthError(e as { name?: string });
  } finally {
    auth.busy = false;
  }
}

export const clearAuthMessages = () => {
  auth.error = '';
  auth.notice = '';
};

export function signIn(email: string, password: string) {
  const problem = validateCredentials(email, password, 'signin');
  if (problem) return void (auth.error = problem);
  return guarded(async () => {
    const { error } = await supabaseClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) auth.error = friendlyAuthError(error);
  });
}

export function signUp(email: string, password: string) {
  const problem = validateCredentials(email, password, 'signup');
  if (problem) return void (auth.error = problem);
  return guarded(async () => {
    const { data, error } = await supabaseClient().auth.signUp({ email: email.trim(), password });
    if (error) auth.error = friendlyAuthError(error);
    // With "Confirm email" on, no session comes back: the user must follow the link first.
    else if (!data.session) auth.notice = 'Check your email and open the confirmation link, then sign in here.';
  });
}
