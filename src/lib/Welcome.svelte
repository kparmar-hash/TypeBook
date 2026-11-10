<script lang="ts">
  import { pickFolder } from './app.svelte';
</script>

<div class="welcome">
  <h1>Typebook</h1>
  <p>A typed notebook with free placement. Click anywhere, start typing.</p>
  <p class="small">
    Choose a <strong>notes folder</strong>. Point it at a folder your sync tool already covers (iCloud Drive, Dropbox,
    OneDrive, Syncthing, a git repo) to share notes between machines.
  </p>
  <button onclick={pickFolder}>Choose notes folder…</button>
</div>

<style>
  .welcome {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    text-align: center;
    background: var(--desk);
  }
  h1 {
    font-family: 'Caveat', cursive;
    font-size: 64px;
    font-weight: 600;
    margin: 0;
  }
  p {
    margin: 0;
    font-size: 15px;
  }
  .small {
    max-width: 440px;
    color: var(--muted);
    font-size: 13px;
    margin: 8px 0 18px;
    line-height: 1.5;
  }
  button {
    background: var(--accent);
    color: #fff;
    border: 0;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 14px;
  }
</style>
