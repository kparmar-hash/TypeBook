<script lang="ts">
  import { addTag, curPage, openSearch, removeTag, renamePage } from './app.svelte';

  const page = $derived(curPage());
  let tagInput = $state('');

  function addFromInput() {
    for (const t of tagInput.split(',')) addTag(t);
    tagInput = '';
  }

  function tagKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addFromInput();
    } else if (e.key === 'Backspace' && !tagInput && page?.tags.length) removeTag(page.tags[page.tags.length - 1]);
    else if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
  }
</script>

{#if page}
  <div class="pagebar">
    {#key page.id}
      <input
        class="title"
        placeholder="Page title"
        value={page.title}
        onchange={(e) => renamePage(page.id, e.currentTarget.value.trim())}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        }}
      />
    {/key}
    <span class="tags">
      {#each page.tags as t (t)}
        <span class="chip">
          <button class="name" title="Search #{t}" onclick={() => openSearch('#' + t)}>#{t}</button>
          <button class="x" title="Remove tag" aria-label="Remove tag {t}" onclick={() => removeTag(t)}>×</button>
        </span>
      {/each}
      <input
        class="add"
        placeholder="+ tag"
        bind:value={tagInput}
        onkeydown={tagKey}
        onblur={addFromInput}
        spellcheck="false"
      />
    </span>
  </div>
{/if}

<style>
  .pagebar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 14px;
    background: var(--chrome);
    border-bottom: 1px solid var(--border);
  }
  .title {
    flex: 0 1 320px;
    min-width: 120px;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    font-weight: 600;
    font-size: 14px;
  }
  .title:hover,
  .title:focus {
    border-color: var(--border);
    background: var(--paper);
    outline: none;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    background: var(--accent-soft);
    border-radius: 4px;
    color: var(--accent);
  }
  .chip button {
    background: none;
    border: 0;
    color: inherit;
    padding: 2px 4px 2px 9px;
    font-size: 12px;
  }
  .chip .x {
    padding: 2px 8px 2px 2px;
    opacity: 0.6;
  }
  .chip .x:hover {
    opacity: 1;
  }
  .add {
    width: 80px;
    padding: 3px 6px;
    border: 1px dashed var(--border);
    border-radius: 4px;
    background: transparent;
    font-size: 12px;
  }
  .add:focus {
    outline: none;
    border-style: solid;
    border-color: var(--accent);
  }
</style>
