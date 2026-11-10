import { describe, expect, it } from 'vitest';
import { friendlyAuthError, validateCredentials } from './authErrors';

describe('validateCredentials', () => {
  it('requires a plausible email and a password', () => {
    expect(validateCredentials('nope', 'x', 'signin')).toMatch(/valid email/);
    expect(validateCredentials('a@b.co', '', 'signin')).toMatch(/password/);
    expect(validateCredentials(' a@b.co ', 'whatever', 'signin')).toBeNull();
  });
  it('does not apply the strength rule when signing in (so existing accounts are never locked out)', () => {
    expect(validateCredentials('a@b.co', 'short', 'signin')).toBeNull();
  });
  it('enforces length when creating an account', () => {
    expect(validateCredentials('a@b.co', 'short', 'signup')).toMatch(/at least 10/);
    expect(validateCredentials('a@b.co', 'a-long-enough-one', 'signup')).toBeNull();
    expect(validateCredentials('a@b.co', 'é'.repeat(40), 'signup')).toMatch(/at most 72/);
  });
});

describe('friendlyAuthError', () => {
  it('maps known codes to plain messages', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials' })).toBe('Wrong email or password.');
    expect(friendlyAuthError({ code: 'email_not_confirmed' })).toMatch(/Confirm your email/);
    expect(friendlyAuthError({ code: 'over_request_rate_limit' })).toMatch(/Too many/);
    expect(friendlyAuthError({ status: 429 })).toMatch(/Too many/);
    expect(friendlyAuthError({ code: 'signup_disabled' })).toMatch(/turned off/);
  });
  it('reports network trouble separately', () => {
    expect(friendlyAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/Could not reach/);
  });
  it('never exposes unknown server text', () => {
    expect(friendlyAuthError({ code: 'some_new_internal_code' })).toBe('Something went wrong. Please try again.');
    expect(friendlyAuthError(null)).toBe('Something went wrong. Please try again.');
  });
  it('gives the same message for sign-in failures whether or not the account exists', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials', status: 400 })).toBe(friendlyAuthError({ code: 'invalid_credentials', status: 400 }));
  });
});
