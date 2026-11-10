<script lang="ts">
  import { onMount } from 'svelte';
  import {
    app,
    boot,
    createPage,
    deleteSelected,
    dismissToast,
    finishEdit,
    nudge,
    openSearch,
    redo,
    selectAll,
    selected,
    showNotebooks,
    linkToPdfPage,
    setStyle,
    stepPage,
    undo,
  } from './lib/app.svelte';
  import { copyDefault, copySelection, handlePasteEvent, pasteFromClipboard } from './lib/actions';
  import { inTauri } from './lib/files';
  import { openPdfPicker, restoreLastPdf, togglePdfPane } from './lib/pdfDoc';
  import { pdf, setPdfWidth } from './lib/pdfState.svelte';
  import PdfPane from './lib/PdfPane.svelte';
  import ContextMenu from './lib/ContextMenu.svelte';
  import PageBar from './lib/PageBar.svelte';
  import Search from './lib/Search.svelte';
  import type { BlockStyle } from './lib/types';
  import Help from './lib/Help.svelte';
  import Sheet from './lib/Sheet.svelte';
  import Sidebar from './lib/Sidebar.svelte';
  import Toolbar from './lib/Toolbar.svelte';
  import ConfigError from './lib/ConfigError.svelte';
  import ConnectError from './lib/ConnectError.svelte';
  import SignIn from './lib/SignIn.svelte';
  import Welcome from './lib/Welcome.svelte';

  onMount(async () => {
    await boot();
    void restoreLastPdf();
  });

  $effect(() => {
    document.documentElement.dataset.theme = app.theme;
  });

  /** Focus is somewhere that owns its own keys: a text field, or the PDF pane (arrows turn pages there). */
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement &&
    (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || !!t.closest('.pdfpane'));

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const move = (ev: MouseEvent) => setPdfWidth(Math.min(innerWidth - 560, Math.max(300, innerWidth - ev.clientX)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  const STYLE_KEYS: BlockStyle[] = ['normal', 'heading', 'definition', 'theorem', 'exercise', 'note', 'quote'];

  function keydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const inField = typing(e.target);
    const key = e.key.toLowerCase();

    if (app.searchOpen) return; // the search box handles its own keys
    if (e.key === 'Escape' && (app.menu || app.exportOpen)) {
      app.menu = null;
      app.exportOpen = false;
      return;
    }

    if (app.help) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        app.help = false;
      }
      return;
    }

    if (mod && !e.shiftKey && !e.altKey && key === 'n') {
      e.preventDefault();
      createPage();
    } else if (mod && !e.shiftKey && !e.altKey && key === 'k') {
      e.preventDefault();
      finishEdit();
      openSearch();
    } else if (mod && e.shiftKey && !e.altKey && key === 'b') {
      e.preventDefault();
      void showNotebooks();
    } else if (mod && !e.shiftKey && !e.altKey && key === 'e') {
      e.preventDefault();
      app.exportOpen = !app.exportOpen;
    } else if (mod && e.altKey && /^Digit[1-7]$/.test(e.code)) {
      e.preventDefault();
      setStyle(STYLE_KEYS[Number(e.code.slice(5)) - 1]);
    } else if (mod && e.shiftKey && !e.altKey && key === 'p') {
      e.preventDefault();
      togglePdfPane();
    } else if (mod && e.shiftKey && !e.altKey && key === 'o') {
      e.preventDefault();
      openPdfPicker();
    } else if (mod && e.shiftKey && !e.altKey && key === 'l') {
      e.preventDefault();
      linkToPdfPage();
    } else if (mod && e.shiftKey && !inField && ['m', 't', 'i'].includes(key)) {
      e.preventDefault();
      copySelection(key === 'm' ? 'markdown' : key === 't' ? 'text' : 'image');
    } else if (mod && e.key === '[') {
      e.preventDefault();
      stepPage(-1);
    } else if (mod && e.key === ']') {
      e.preventDefault();
      stepPage(1);
    } else if (inField) {
      return; // native text editing (including native undo) owns everything else
    } else if (mod && key === 'c' && selected.size && !window.getSelection()?.toString()) {
      e.preventDefault();
      copyDefault();
    } else if (mod && key === 'v' && inTauri) {
      e.preventDefault();
      pasteFromClipboard();
    } else if (mod && key === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && key === 'a') {
      e.preventDefault();
      selectAll();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selected.size) {
        e.preventDefault();
        deleteSelected();
      }
    } else if (e.key.startsWith('Arrow') && selected.size) {
      e.preventDefault();
      const step = e.shiftKey ? 24 : 4;
      nudge(
        e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
      );
    } else if (e.key === 'Escape') {
      finishEdit();
      selected.clear();
    } else if (e.key === '?') {
      app.help = true;
    }
  }
</script>

<svelte:window onkeydown={keydown} onpaste={(e) => !inTauri && handlePasteEvent(e)} />

{#if app.loading}
  <div class="boot"></div>
{:else if app.fatal}
  <ConfigError />
{:else if app.backend === 'supabase' && app.connectError}
  <ConnectError />
{:else if app.backend === 'supabase' && !app.root}
  <SignIn />
{:else if !app.root}
  <Welcome />
{:else}
  <div class="shell">
    <Sidebar />
    <main>
      {#if app.nbId}
        <Toolbar />
        <PageBar />
      {/if}
      <div class="work">
        {#if app.nbId}
          <Sheet />
        {:else}
          <div class="placeholder">
            <p>Choose a notebook to see its pages.</p>
          </div>
        {/if}
        {#if pdf.open}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="splitter" onmousedown={startResize}></div>
          <PdfPane />
        {/if}
      </div>
    </main>
  </div>
{/if}

<Help />
<Search />
<ContextMenu />

<div class="toasts">
  {#each app.toasts as t (t.id)}
    <div class="toast">
      <span>{t.text}</span>
      {#if t.action}
        <button
          onclick={() => {
            t.action!.run();
            dismissToast(t.id);
          }}>{t.action.label}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .shell {
    display: flex;
    height: 100%;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .work {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .placeholder {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--muted);
    background: var(--desk);
  }
  .splitter {
    flex: none;
    width: 5px;
    margin: 0 -2px;
    z-index: 5;
    cursor: col-resize;
  }
  .splitter:hover {
    background: var(--accent-soft);
  }
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 60;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #2b2c30;
    color: #f2f0ea;
    padding: 9px 14px;
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .toast button {
    background: none;
    border: 0;
    color: #9fc1ff;
    font-weight: 600;
  }
</style>
