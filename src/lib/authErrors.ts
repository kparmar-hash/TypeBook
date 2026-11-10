export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 72; // bcrypt (used by Supabase Auth) ignores anything past 72 bytes

export type Mode = 'signin' | 'signup';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side checks before anything is sent. Returns a message to show, or null if fine. */
export function validateCredentials(email: string, password: string, mode: Mode): string | null {
  if (!EMAIL.test(email.trim())) return 'Enter a valid email address.';
  if (!password) return 'Enter your password.';
  if (mode === 'signup') {
    if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters for your password.`;
    if (new TextEncoder().encode(password).length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} bytes for your password.`;
  }
  return null;
}

/**
 * Turn an auth failure into something safe to show. The server's raw text is never displayed, and sign-in
 * failures do not reveal whether an email address has an account.
 */
export function friendlyAuthError(err: { code?: string; status?: number; name?: string } | null | undefined): string {
  switch (err?.code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'email_not_confirmed':
      return 'Confirm your email first: open the link we sent you, then sign in.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
    case 'over_sms_send_rate_limit':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'weak_password':
      return 'That password is too easy to guess. Choose a longer, less common one.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'New accounts are turned off for this project.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Try signing in instead.';
    case 'validation_failed':
      return 'Check the email address and password and try again.';
  }
  if (err?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (err?.name === 'AuthRetryableFetchError' || err?.status === 0 || err?.status === 502 || err?.status === 503)
    return 'Could not reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
