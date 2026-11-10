<script lang="ts">
  import { app, retryConnect, signOut } from './app.svelte';

  let busy = $state(false);
  async function retry() {
    busy = true;
    await retryConnect();
    busy = false;
  }
</script>

<main class="wrap">
  <div class="card" role="alert">
    <h1>Can't load your notebooks</h1>
    <p>Typebook couldn't reach the server. Check your connection and try again. Nothing has been lost.</p>
    <div class="row">
      <button class="go" onclick={retry} disabled={busy}>{busy ? 'Trying…' : 'Try again'}</button>
      <button onclick={signOut}>Sign out</button>
    </div>
    <!-- the technical reason stays out of sight but is available on hover for troubleshooting -->
    <small title={app.connectError}>Details</small>
  </div>
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
    width: min(420px, 100%);
    padding: 26px 28px;
    background: var(--chrome);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
  }
  h1 {
    margin: 0 0 8px;
    font-size: 20px;
  }
  p {
    margin: 0 0 16px;
    color: var(--muted);
    line-height: 1.5;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--chrome-2);
  }
  .go {
    background: var(--accent);
    color: #fff;
    border: 0;
    font-weight: 600;
  }
  small {
    display: block;
    margin-top: 12px;
    color: var(--muted);
    font-size: 11px;
    cursor: help;
  }
</style>
