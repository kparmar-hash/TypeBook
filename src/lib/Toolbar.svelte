<script lang="ts">
  import {
    app,
    openSearch,
    setCopyAs,
    curNb,
    curPage,
    redo,
    setInk,
    setPagePaper,
    setTheme,
    toggleSidebar,
    toggleSnap,
    undo,
    updateNotebook,
  } from './app.svelte';
  import { copySelection, exportNotebook, exportPage } from './actions';
  import { togglePdfPane } from './pdfDoc';
  import { pdf } from './pdfState.svelte';
  import { selected } from './app.svelte';
  import { FONTS, INKS, PAPERS } from './fonts';
  import type { FontKey, Page } from './types';

  const nb = $derived(curNb());
  const page = $derived(curPage());

  /** Keep focus in the block being edited while using toolbar buttons. */
  const keepFocus = (e: MouseEvent) => {
    if (!(e.target instanceof HTMLSelectElement)) e.preventDefault();
  };

  const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const cycleTheme = () => setTheme(app.theme === 'system' ? 'light' : app.theme === 'light' ? 'dark' : 'system');
  const themeIcon = $derived(app.theme === 'system' ? '◐' : app.theme === 'light' ? '☀' : '☾');
</script>

<svelte:window
  onmousedown={(e) => {
    if (app.exportOpen && !(e.target as HTMLElement).closest?.('.menuwrap')) app.exportOpen = false;
  }}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bar" onmousedown={keepFocus}>
  {#if nb && page}
    <button
      class="panel"
      class:on={app.sidebarOpen}
      title="{app.sidebarOpen ? 'Hide' : 'Show'} pages ({mod}\)"
      aria-label="{app.sidebarOpen ? 'Hide' : 'Show'} pages"
      aria-pressed={app.sidebarOpen}
      onclick={toggleSidebar}
    >
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">
        <rect x="0.7" y="0.7" width="14.6" height="12.6" rx="2" />
        <path d="M5.5 0.7v12.6" />
        {#if app.sidebarOpen}<rect x="1.4" y="1.4" width="3.4" height="11.2" fill="currentColor" stroke="none" opacity="0.35" />{/if}
      </svg>
    </button>
    <label title="Paper for this page">
      Page
      <select value={page.paper} onchange={(e) => setPagePaper(e.currentTarget.value as Page['paper'])}>
        <option value="default">Default</option>
        {#each PAPERS as p}<option value={p.key}>{p.label}</option>{/each}
      </select>
    </label>
    <label title="Notebook default paper">
      Book
      <select value={nb.paper} onchange={(e) => updateNotebook({ paper: e.currentTarget.value as typeof nb.paper })}>
        {#each PAPERS as p}<option value={p.key}>{p.label}</option>{/each}
      </select>
    </label>
    <label title="Notebook handwriting font">
      <select aria-label="Font" value={nb.font} onchange={(e) => updateNotebook({ font: e.currentTarget.value as FontKey })}>
        {#each Object.entries(FONTS) as [key, f]}<option value={key}>{f.label}</option>{/each}
      </select>
    </label>
    <span class="size">
      <button title="Smaller text" onclick={() => updateNotebook({ fontSize: Math.max(14, nb.fontSize - 2) })}>A−</button>
      <span>{nb.fontSize}</span>
      <button title="Larger text" onclick={() => updateNotebook({ fontSize: Math.min(48, nb.fontSize + 2) })}>A+</button>
    </span>
    <span class="inks" role="group" aria-label="Ink colour">
      {#each INKS as ink}
        <button
          class="ink"
          class:on={nb.ink === ink.key}
          title="{ink.label} ink"
          style="--c: var(--ink-{ink.key})"
          onclick={() => setInk(ink.key)}
          aria-label="{ink.label} ink"
        ></button>
      {/each}
    </span>
    <button class:on={nb.margin} title="Margin line (ruled paper)" onclick={() => updateNotebook({ margin: !nb.margin })}>Margin</button>
    <button class:on={app.snap} title="Snap to grid and aligned blocks (hold Alt to bypass)" onclick={toggleSnap}>Snap</button>
    <span class="grow"></span>
    <button class:on={pdf.open} title="PDF pane ({mod}Shift+P)" onclick={togglePdfPane}>PDF</button>
    <button title="Search all notebooks ({mod}K)" onclick={() => openSearch()}>🔍</button>
    <span class="menuwrap">
      <button class:on={app.exportOpen} title="Copy and export ({mod}E)" onclick={() => (app.exportOpen = !app.exportOpen)}>Export ▾</button>
      {#if app.exportOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="dropdown" onmousedown={(e) => e.stopPropagation()}>
          <div class="group">Selection{selected.size ? ` (${selected.size})` : ''}</div>
          <button disabled={!selected.size} onclick={() => { app.exportOpen = false; copySelection('markdown'); }}>Copy as Markdown<kbd>{mod}Shift+M</kbd></button>
          <button disabled={!selected.size} onclick={() => { app.exportOpen = false; copySelection('text'); }}>Copy as plain text<kbd>{mod}Shift+T</kbd></button>
          <button disabled={!selected.size} onclick={() => { app.exportOpen = false; copySelection('image'); }}>Copy as image<kbd>{mod}Shift+I</kbd></button>
          <div class="group">{mod}C copies as</div>
          <div class="seg">
            <button class:on={app.copyAs === 'markdown'} onclick={() => setCopyAs('markdown')}>Markdown</button>
            <button class:on={app.copyAs === 'text'} onclick={() => setCopyAs('text')}>Plain text</button>
          </div>
          <div class="group">This page</div>
          <button onclick={() => exportPage('md')}>Markdown…</button>
          <button onclick={() => exportPage('png')}>PNG image…</button>
          <button onclick={() => exportPage('pdf')}>PDF…</button>
          <div class="group">Whole notebook</div>
          <button onclick={() => exportNotebook('md')}>Folder of Markdown files…</button>
          <button onclick={() => exportNotebook('pdf')}>Single PDF…</button>
        </div>
      {/if}
    </span>
    {#if app.saveError}<span class="err" title={app.saveError}>⚠ Save failed — retrying</span>{/if}
    <button title="Undo (Ctrl/Cmd+Z)" onclick={undo}>↶</button>
    <button title="Redo (Ctrl/Cmd+Shift+Z)" onclick={redo}>↷</button>
    <button title="Theme: {app.theme}" onclick={cycleTheme}>{themeIcon}</button>
    <button title="Keyboard shortcuts (?)" onclick={() => (app.help = true)}>?</button>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--chrome);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 12px;
  }
  select,
  button {
    background: var(--chrome-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px 6px;
  }
  select {
    max-width: 112px;
  }
  button:hover {
    border-color: var(--muted);
  }
  button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .size {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .size span {
    min-width: 22px;
    text-align: center;
    color: var(--muted);
  }
  .inks {
    display: flex;
    gap: 5px;
  }
  .ink {
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 50%;
    background: var(--c);
    border: 2px solid transparent;
    outline: 1px solid var(--border);
  }
  .ink.on {
    background: var(--c);
    border-color: var(--chrome);
    outline: 2px solid var(--c);
  }
  .menuwrap {
    position: relative;
  }
  .dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 40;
    min-width: 270px;
    padding: 5px;
    background: var(--chrome);
    border: 1px solid var(--border);
    border-radius: 9px;
    box-shadow: var(--shadow);
  }
  .dropdown .group {
    padding: 6px 9px 3px;
    font-size: 10px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .dropdown button {
    display: flex;
    width: 100%;
    justify-content: space-between;
    gap: 16px;
    border: 0;
    background: none;
    text-align: left;
  }
  .dropdown button:hover:not(:disabled) {
    background: var(--accent-soft);
  }
  .dropdown button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .dropdown kbd {
    font-size: 10px;
    color: var(--muted);
  }
  .seg {
    display: flex;
    gap: 4px;
    padding: 0 4px 4px;
  }
  .seg button {
    justify-content: center;
    border: 1px solid var(--border);
  }
  .seg button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .panel {
    display: grid;
    place-items: center;
    padding: 4px 7px;
  }
  .grow {
    flex: 1;
  }
  .err {
    color: #d1493b;
    font-size: 12px;
  }
</style>
