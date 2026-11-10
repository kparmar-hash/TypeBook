<script lang="ts">
  import { app } from './app.svelte';
  import { auth, clearAuthMessages, signIn, signUp } from './auth.svelte';
  import { MIN_PASSWORD, type Mode } from './authErrors';

  let mode = $state<Mode>('signin');
  let email = $state('');
  let password = $state('');
  let show = $state(false);

  const busy = $derived(auth.busy || app.opening);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    await (mode === 'signin' ? signIn(email, password) : signUp(email, password));
    if (auth.notice) password = '';
  }

  function switchMode(m: Mode) {
    mode = m;
    clearAuthMessages();
  }
</script>

<main class="wrap">
  <form class="card" onsubmit={submit} novalidate>
    <h1>Typebook</h1>
    <p class="tag">Your notebooks, on every device.</p>

    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected={mode === 'signin'} class:on={mode === 'signin'} onclick={() => switchMode('signin')}>Sign in</button>
      <button type="button" role="tab" aria-selected={mode === 'signup'} class:on={mode === 'signup'} onclick={() => switchMode('signup')}>Create account</button>
    </div>

    <label>
      Email
      <!-- svelte-ignore a11y_autofocus -->
      <input type="email" name="email" autocomplete="username" autocapitalize="off" spellcheck="false" autofocus bind:value={email} disabled={busy} />
    </label>

    <label>
      Password
      <span class="pw">
        <input
          type={show ? 'text' : 'password'}
          name="password"
          autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
          bind:value={password}
          disabled={busy}
        />
        <button type="button" class="eye" onclick={() => (show = !show)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
    {#if mode === 'signup'}<p class="hint">At least {MIN_PASSWORD} characters. A passphrase works well.</p>{/if}

    {#if auth.error}<p class="msg err" role="alert">{auth.error}</p>{/if}
    {#if auth.notice}<p class="msg ok" role="status">{auth.notice}</p>{/if}

    <button class="go" type="submit" disabled={busy}>
      {#if app.opening}Loading your notebooks…{:else if auth.busy}Please wait…{:else if mode === 'signin'}Sign in{:else}Create account{/if}
    </button>
  </form>
</main>

<style>
  .wrap {
    height: 100%;
    display: grid;
    place-items: center;
    background: var(--desk);
    padding: 20px;
  }
  .card {
    width: min(380px, 100%);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 28px 28px 24px;
    background: var(--chrome);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
  }
  h1 {
    margin: 0;
    font-family: 'Caveat', cursive;
    font-size: 46px;
    font-weight: 600;
    text-align: center;
    line-height: 1;
  }
  .tag {
    margin: 0 0 6px;
    text-align: center;
    color: var(--muted);
  }
  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 3px;
    background: var(--chrome-2);
    border-radius: 8px;
  }
  .tabs button {
    padding: 6px;
    border: 0;
    border-radius: 6px;
    background: none;
  }
  .tabs button.on {
    background: var(--paper);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
    font-weight: 600;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }
  input {
    padding: 8px 10px;
    font-size: 14px;
    color: var(--text);
    background: var(--paper);
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  input:focus {
    outline: 2px solid var(--accent-soft);
    border-color: var(--accent);
  }
  .pw {
    position: relative;
    display: flex;
  }
  .pw input {
    flex: 1;
    padding-right: 58px;
  }
  .eye {
    position: absolute;
    right: 4px;
    top: 4px;
    bottom: 4px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--accent);
    font-size: 12px;
  }
  .hint {
    margin: -6px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .msg {
    margin: 0;
    padding: 8px 10px;
    border-radius: 7px;
    font-size: 13px;
  }
  .err {
    color: #b3372b;
    background: rgba(209, 73, 59, 0.12);
  }
  .ok {
    color: #1d6b3b;
    background: rgba(47, 143, 85, 0.14);
  }
  .go {
    margin-top: 4px;
    padding: 10px;
    border: 0;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
  }
  .go:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
