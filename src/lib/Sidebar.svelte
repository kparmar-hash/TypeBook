<script lang="ts">
  import {
    app,
    changeFolder,
    createNotebook,
    createPage,
    deleteNotebook,
    deletePage,
    duplicatePage,
    movePage,
    renameNotebook,
    renamePage,
    selectNotebook,
    selectPage,
    showNotebooks,
    signOut,
    visiblePages,
    curNb,
  } from './app.svelte';
  import Thumb from './Thumb.svelte';

  let renamingPage = $state<string | null>(null);
  let renamingNb = $state<string | null>(null);
  let newNb = $state(false);
  let dragId = $state<string | null>(null);
  let overIndex = $state<number | null>(null);

  const pages = $derived(visiblePages());
  const nb = $derived(curNb());
  const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  const focusSelect = (el: HTMLInputElement) => {
    el.focus();
    el.select();
  };

  function commitPage(e: Event, id: string) {
    renamePage(id, (e.currentTarget as HTMLInputElement).value.trim());
    renamingPage = null;
  }

  function keyInput(e: KeyboardEvent, done: () => void) {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
    else if (e.key === 'Escape') {
      done();
    }
  }

  function drop(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragId) movePage(dragId, index > pages.findIndex((p) => p.id === dragId) ? index - 1 : index);
    dragId = overIndex = null;
  }
</script>

<aside>
  {#if app.view === 'notebooks'}
    <section class="notebooks">
      <header>
        <span>Notebooks</span>
        <button class="icon" title="New notebook" onclick={() => (newNb = true)}>+</button>
      </header>
      <ul>
        {#each app.notebooks as n (n.id)}
          <li class:active={n.id === app.nbId}>
            {#if renamingNb === n.id}
              <input
                class="inline"
                value={n.name}
                use:focusSelect
                onkeydown={(e) => keyInput(e, () => (renamingNb = null))}
                onblur={(e) => {
                  renameNotebook(n.id, e.currentTarget.value);
                  renamingNb = null;
                }}
              />
            {:else}
              <button class="row" onclick={() => selectNotebook(n.id)} ondblclick={() => (renamingNb = n.id)}>
                <span class="nbname">{n.name}</span>
                <span class="count">{n.pageOrder.length} {n.pageOrder.length === 1 ? 'page' : 'pages'}</span>
              </button>
              <button class="icon hover" title="Rename notebook" onclick={() => (renamingNb = n.id)}>✎</button>
              <button class="icon hover" title="Delete notebook" onclick={() => deleteNotebook(n.id)}>×</button>
            {/if}
          </li>
        {:else}
          {#if !newNb}<li class="none">No notebooks yet. Press + to add one.</li>{/if}
        {/each}
        {#if newNb}
          <li>
            <input
              class="inline"
              placeholder="Notebook name"
              use:focusSelect
              onkeydown={(e) => keyInput(e, () => (newNb = false))}
              onblur={(e) => {
                const v = e.currentTarget.value.trim();
                newNb = false;
                if (v) createNotebook(v);
              }}
            />
          </li>
        {/if}
      </ul>
    </section>
  {:else}
    <section class="pages">
      <header class="crumb">
        <button class="back" title="All notebooks ({mod}Shift+B)" onclick={showNotebooks}>‹ Notebooks</button>
        <button class="icon" title="New page ({mod}N)" onclick={createPage}>+</button>
      </header>
      <div class="nbtitle" title={nb?.name}>{nb?.name}</div>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <ul ondragover={(e) => e.preventDefault()} ondrop={(e) => drop(e, pages.length)}>
        {#each pages as p, i (p.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="page"
            class:active={p.id === app.pageId}
            class:over={overIndex === i && dragId !== p.id}
            draggable={renamingPage !== p.id}
            ondragstart={(e) => {
              dragId = p.id;
              e.dataTransfer?.setData('text/plain', p.id);
            }}
            ondragover={(e) => {
              e.preventDefault();
              overIndex = i;
            }}
            ondrop={(e) => {
              e.stopPropagation();
              drop(e, i);
            }}
            ondragend={() => (dragId = overIndex = null)}
          >
            <button class="thumb" onclick={() => selectPage(p.id)} aria-label="Open page">
              {#if nb}<Thumb page={p} {nb} />{/if}
            </button>
            <div class="meta">
              {#if renamingPage === p.id}
                <input
                  class="inline"
                  value={p.title}
                  placeholder="Untitled"
                  use:focusSelect
                  onkeydown={(e) => keyInput(e, () => (renamingPage = null))}
                  onblur={(e) => commitPage(e, p.id)}
                />
              {:else}
                <button class="name" onclick={() => selectPage(p.id)} ondblclick={() => (renamingPage = p.id)}>
                  {p.title || `Page ${i + 1}`}
                </button>
              {/if}
              <span class="acts">
                <button class="icon" title="Rename" onclick={() => (renamingPage = p.id)}>✎</button>
                <button class="icon" title="Duplicate" onclick={() => duplicatePage(p.id)}>⧉</button>
                <button class="icon" title="Delete" onclick={() => deletePage(p.id)}>×</button>
              </span>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <footer>
    {#if app.backend === 'supabase'}
      <div class="account">
        <span class="who" title={app.user ?? ''}>{app.user}</span>
        <button class="signout" onclick={signOut}>Sign out</button>
      </div>
    {:else}
      <button class="folder" onclick={changeFolder} title={app.root ?? ''}>
        📁 {app.root?.split(/[\\/]/).filter(Boolean).pop() ?? 'Notes folder'}
      </button>
    {/if}
  </footer>
</aside>

<style>
  aside {
    width: 248px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--chrome);
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  section {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .notebooks,
  .pages {
    flex: 1;
  }
  .crumb {
    padding-top: 8px;
  }
  .back {
    background: none;
    border: 0;
    padding: 3px 6px;
    margin-left: -4px;
    border-radius: 5px;
    color: var(--accent);
    font-size: 12px;
    letter-spacing: normal;
    text-transform: none;
  }
  .back:hover {
    background: var(--accent-soft);
  }
  .nbtitle {
    padding: 0 12px 8px;
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    padding: 12px;
    color: var(--muted);
  }
  .nbname {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    display: block;
    font-size: 11px;
    color: var(--muted);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px 6px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 6px 8px;
    overflow-y: auto;
    flex: 1;
  }
  .notebooks li {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }
  .notebooks li.active {
    background: var(--accent-soft);
  }
  .row {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: 0;
    padding: 8px 10px;
    white-space: nowrap;
  }
  .icon {
    background: none;
    border: 0;
    border-radius: 4px;
    color: var(--muted);
    width: 22px;
    height: 22px;
    line-height: 1;
    padding: 0;
  }
  .icon:hover {
    background: var(--chrome-2);
    color: var(--text);
  }
  .hover {
    opacity: 0;
  }
  li:hover .hover {
    opacity: 1;
  }
  .inline {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--accent);
    border-radius: 5px;
    background: var(--paper);
    outline: none;
  }
  .page {
    display: block;
    padding: 6px;
    border-radius: 8px;
    border: 1px solid transparent;
    margin-bottom: 4px;
  }
  .page.active {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .page.over {
    box-shadow: 0 -2px 0 var(--accent);
  }
  .thumb {
    display: block;
    width: 100%;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    background: none;
    line-height: 0;
  }
  .thumb :global(svg) {
    width: 100%;
    height: auto;
  }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 5px;
    gap: 4px;
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: 0;
    padding: 2px 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acts {
    display: flex;
    opacity: 0;
  }
  .page:hover .acts,
  .page.active .acts {
    opacity: 1;
  }
  footer {
    border-top: 1px solid var(--border);
    padding: 8px;
  }
  .folder {
    width: 100%;
    text-align: left;
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .account {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 2px 2px 6px;
  }
  .who {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 12px;
  }
  .signout {
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--chrome-2);
    font-size: 12px;
  }
  .signout:hover {
    border-color: var(--muted);
  }
  .folder:hover {
    color: var(--text);
    background: var(--chrome-2);
  }
</style>
