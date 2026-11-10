<script lang="ts">
  import { app, openPage, searchIndex } from './app.svelte';
  import { search } from './search';

  let active = $state(0);
  let input = $state<HTMLInputElement>();

  const hits = $derived.by(() => {
    if (!app.searchOpen) return [];
    const live = new Set(app.notebooks.map((n) => n.id));
    return search([...searchIndex()].filter((e) => live.has(e.nbId)), app.searchQuery);
  });
  const nbName = (id: string) => app.notebooks.find((n) => n.id === id)?.name ?? '';

  $effect(() => {
    app.searchQuery;
    active = 0;
  });
  $effect(() => {
    if (app.searchOpen) queueMicrotask(() => input?.focus());
  });

  const close = () => (app.searchOpen = false);

  async function choose(i: number) {
    const hit = hits[i];
    if (!hit) return;
    close();
    await openPage(hit.entry.nbId, hit.entry.pageId);
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') active = Math.min(hits.length - 1, active + 1);
    else if (e.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (e.key === 'Enter') void choose(active);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

{#if app.searchOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card" role="dialog" tabindex="-1" aria-label="Search" onclick={(e) => e.stopPropagation()}>
      <input
        bind:this={input}
        bind:value={app.searchQuery}
        onkeydown={key}
        placeholder="Search all notebooks — titles, text, math (\gcd), #tags"
        spellcheck="false"
      />
      <ul>
        {#each hits as hit, i (hit.entry.pageId)}
          <li class:active={i === active}>
            <button onmousemove={() => (active = i)} onclick={() => choose(i)}>
              <span class="top">
                <strong>{hit.entry.title || 'Untitled page'}</strong>
                <span class="nb">{nbName(hit.entry.nbId)}</span>
                {#each hit.entry.tags as t}<span class="tag">#{t}</span>{/each}
              </span>
              <span class="snip">{hit.snippet}</span>
            </button>
          </li>
        {:else}
          {#if app.searchQuery.trim()}<li class="none">No matches</li>{/if}
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    padding-top: 12vh;
    z-index: 55;
  }
  .card {
    width: min(680px, 92vw);
    max-height: 70vh;
    align-self: flex-start;
    display: flex;
    flex-direction: column;
    background: var(--chrome);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  input {
    padding: 14px 16px;
    font-size: 15px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
  }
  li button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    padding: 8px 10px;
    border-radius: 7px;
  }
  li.active button {
    background: var(--accent-soft);
  }
  .top {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .nb {
    color: var(--muted);
    font-size: 11px;
  }
  .tag {
    font-size: 11px;
    color: var(--accent);
  }
  .snip {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .none {
    padding: 14px;
    color: var(--muted);
  }
</style>
