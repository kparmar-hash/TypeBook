<script lang="ts">
  import 'pdfjs-dist/web/pdf_viewer.css';
  import { linkToPdfPage, selected } from './app.svelte';
  import {
    closePdf,
    goToPage,
    nextPage,
    openPdfPicker,
    prevPage,
    recordPdfCopy,
    renderCurrent,
    searchPdf,
    setZoom,
    stepMatch,
    zoomBy,
  } from './pdfDoc';
  import { pdf, setAutoLink } from './pdfState.svelte';

  let canvas = $state<HTMLCanvasElement>();
  let text = $state<HTMLDivElement>();
  let scroller = $state<HTMLDivElement>();
  let avail = $state(0);
  let pageInput = $state('1');
  let query = $state('');

  $effect(() => {
    pageInput = String(pdf.page);
  });

  $effect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => (avail = scroller!.clientWidth));
    ro.observe(scroller);
    return () => ro.disconnect();
  });

  // Re-render when the page, document or zoom changes (the width only matters in fit-to-width mode).
  $effect(() => {
    pdf.page;
    pdf.zoom;
    const hash = pdf.hash;
    const width = pdf.zoom === 0 ? avail : 1;
    if (canvas && text && hash && width) void renderCurrent(canvas, text, avail || 600);
  });

  $effect(() => {
    pdf.page;
    scroller?.scrollTo(0, 0);
  });

  function paneKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const act: Record<string, () => void> = {
      ArrowRight: nextPage,
      PageDown: nextPage,
      ArrowLeft: prevPage,
      PageUp: prevPage,
      Home: () => goToPage(1),
      End: () => goToPage(pdf.numPages),
      '+': () => zoomBy(1.15),
      '=': () => zoomBy(1.15),
      '-': () => zoomBy(1 / 1.15),
      '0': () => setZoom(0),
    };
    if (act[e.key]) {
      e.preventDefault();
      act[e.key]();
    }
  }

  function searchKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (query.trim() === pdf.query.trim() && pdf.matchCount) stepMatch(e.shiftKey ? -1 : 1);
      else void searchPdf(query);
    } else if (e.key === 'Escape') {
      query = '';
      void searchPdf('');
      (e.currentTarget as HTMLElement).blur();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section class="pdfpane" tabindex="-1" style="width:{pdf.width}px" oncopy={recordPdfCopy} onkeydown={paneKey} aria-label="PDF">
  <header>
    <span class="name" title={pdf.name}>{pdf.name || 'PDF'}</span>
    <button onclick={openPdfPicker}>Open…</button>
    <button class="x" title="Close pane (Ctrl/Cmd+Shift+P)" aria-label="Close PDF pane" onclick={closePdf}>×</button>
  </header>

  {#if pdf.hash}
    <div class="tools">
      <button title="Previous page (←)" onclick={prevPage} disabled={pdf.page <= 1}>◀</button>
      <input
        class="pageno"
        aria-label="Page number"
        bind:value={pageInput}
        onfocus={(e) => e.currentTarget.select()}
        onkeydown={(e) => e.key === 'Enter' && (goToPage(Number(pageInput)), e.currentTarget.blur())}
        onblur={() => (pageInput = String(pdf.page))}
      />
      <span class="muted">/ {pdf.numPages}</span>
      <button title="Next page (→)" onclick={nextPage} disabled={pdf.page >= pdf.numPages}>▶</button>
      <span class="sep"></span>
      <button title="Zoom out (-)" onclick={() => zoomBy(1 / 1.15)}>−</button>
      <span class="muted zoom">{Math.round(pdf.scale * 100)}%</span>
      <button title="Zoom in (+)" onclick={() => zoomBy(1.15)}>+</button>
      <button class:on={pdf.zoom === 0} title="Fit width (0)" onclick={() => setZoom(0)}>Fit</button>
    </div>
    <div class="tools">
      <input
        class="search"
        placeholder="Search in PDF"
        bind:value={query}
        onfocus={(e) => e.currentTarget.select()}
        onkeydown={searchKey}
        spellcheck="false"
      />
      <span class="muted count">
        {#if pdf.searching}Searching…{:else if pdf.query && !pdf.matchCount}No matches{:else if pdf.matchCount}{pdf.matchIdx + 1} / {pdf.matchCount}{/if}
      </span>
      <button title="Previous match (Shift+Enter)" onclick={() => stepMatch(-1)} disabled={!pdf.matchCount}>↑</button>
      <button title="Next match (Enter)" onclick={() => stepMatch(1)} disabled={!pdf.matchCount}>↓</button>
    </div>
    <div class="tools">
      <label title="New blocks get a link to the page showing here">
        <input type="checkbox" checked={pdf.autoLink} onchange={(e) => setAutoLink(e.currentTarget.checked)} />
        Link new blocks
      </label>
      <span class="grow"></span>
      <button
        disabled={!selected.size}
        title="Link the selected blocks to this page (Ctrl/Cmd+Shift+L)"
        onclick={() => linkToPdfPage()}>Link selected</button
      >
    </div>
  {/if}

  <div class="scroller" bind:this={scroller}>
    {#if pdf.hash}
      <div class="page">
        <canvas bind:this={canvas}></canvas>
        <div class="textLayer" bind:this={text}></div>
      </div>
    {:else}
      <div class="empty">
        {#if pdf.loading}Loading…{:else}
          <p>Open a PDF to read beside your notes.</p>
          <button class="primary" onclick={openPdfPicker}>Open a PDF…</button>
        {/if}
      </div>
    {/if}
    {#if pdf.error}<p class="err">{pdf.error}</p>{/if}
  </div>
</section>

<style>
  .pdfpane {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--chrome);
    border-left: 1px solid var(--border);
    outline: none;
  }
  header,
  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }
  header {
    padding: 7px 10px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button,
  input:not([type='checkbox']) {
    background: var(--chrome-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px 7px;
  }
  button:hover:not(:disabled) {
    border-color: var(--muted);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .x {
    border-color: transparent;
    background: none;
    font-size: 16px;
    line-height: 1;
  }
  .pageno {
    width: 46px;
    text-align: center;
  }
  .search {
    flex: 1;
    min-width: 0;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
  .zoom {
    min-width: 38px;
    text-align: center;
  }
  .count {
    min-width: 64px;
    text-align: right;
  }
  .sep {
    width: 8px;
  }
  .grow {
    flex: 1;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
  }
  .scroller {
    flex: 1;
    overflow: auto;
    background: var(--desk);
    padding: 12px;
  }
  .page {
    position: relative;
    width: fit-content;
    margin: 0 auto;
    background: #fff;
    box-shadow: var(--shadow);
  }
  canvas {
    display: block;
  }
  .page :global(.textLayer) {
    position: absolute;
    inset: 0;
  }
  .page :global(.textLayer span.hit) {
    background: rgba(255, 213, 0, 0.5);
    border-radius: 2px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 80px;
    color: var(--muted);
    text-align: center;
  }
  .primary {
    background: var(--accent);
    color: #fff;
    border: 0;
    padding: 8px 14px;
  }
  .err {
    color: #d1493b;
    font-size: 12px;
  }
</style>
