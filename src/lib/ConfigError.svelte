<script lang="ts">
  import { app } from './app.svelte';
</script>

<main class="wrap">
  <div class="card" role="alert">
    <h1>Typebook can't start</h1>
    <p class="why">{app.fatal}</p>
    <p class="how">
      Fix <code>.env</code> (copy <code>.env.example</code> if you do not have one), then restart the app. Use the
      <strong>publishable / anon</strong> key from Supabase → Project Settings → API. Never put a
      <code>service_role</code> or <code>sb_secret_…</code> key in the app.
    </p>
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
    width: min(520px, 100%);
    padding: 26px 28px;
    background: var(--chrome);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
  }
  h1 {
    margin: 0 0 10px;
    font-size: 20px;
  }
  .why {
    margin: 0 0 14px;
    padding: 10px 12px;
    color: #b3372b;
    background: rgba(209, 73, 59, 0.12);
    border-radius: 8px;
  }
  .how {
    margin: 0;
    color: var(--muted);
    line-height: 1.55;
  }
  code {
    font-family: var(--mono-font);
    font-size: 12px;
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 4px;
  }
</style>
