<script lang="ts">
  import { copySelection } from './actions';
  import { app, closeMenu, curPage, deleteSelected, linkToPdfPage, selected, setImageSize, setStyle, unlinkPdf } from './app.svelte';
  import { pdf } from './pdfState.svelte';
  import type { BlockStyle, ImageSize } from './types';

  const STYLES: [BlockStyle, string, string][] = [
    ['normal', 'Normal', '1'],
    ['heading', 'Heading', '2'],
    ['definition', 'Definition', '3'],
    ['theorem', 'Theorem', '4'],
    ['exercise', 'Exercise', '5'],
    ['note', 'Note', '6'],
    ['quote', 'Quote', '7'],
  ];
  const SIZES: [ImageSize, string][] = [
    ['s', 'Small'],
    ['m', 'Medium'],
    ['l', 'Large'],
  ];

  const menu = $derived(app.menu);
  const page = $derived(curPage());
  const isImage = $derived(!!menu && !!page?.images.some((i) => i.id === menu.id));
  const current = $derived(page?.blocks.find((b) => b.id === menu?.id)?.style);
  const currentSize = $derived(page?.images.find((i) => i.id === menu?.id)?.size);
  const anyRef = $derived(!!page?.blocks.some((b) => selected.has(b.id) && b.ref));
  const mod = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  const run = (fn: () => void) => () => {
    fn();
    closeMenu();
  };

  // keep the menu inside the window
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - 8) el.style.left = innerWidth - r.width - 8 + 'px';
    if (r.bottom > innerHeight - 8) el.style.top = innerHeight - r.height - 8 + 'px';
  };
</script>

<svelte:window onmousedown={() => app.menu && closeMenu()} onblur={closeMenu} />

{#if menu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="menu"
    role="menu"
    tabindex="-1"
    use:place
    style="left:{menu.x}px; top:{menu.y}px"
    onmousedown={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#if isImage}
      <div class="group">Size</div>
      {#each SIZES as [size, label]}
        <button role="menuitem" class:on={currentSize === size} onclick={run(() => setImageSize(menu.id, size))}>{label}</button>
      {/each}
    {:else}
      <div class="group">Style</div>
      {#each STYLES as [style, label, key]}
        <button role="menuitem" class:on={current === style} onclick={run(() => setStyle(style, [...selected]))}>
          {label}<kbd>{mod}Alt+{key}</kbd>
        </button>
      {/each}
    {/if}
    {#if !isImage}
      <hr />
      <button role="menuitem" disabled={!pdf.hash} onclick={run(() => linkToPdfPage([...selected]))}>
        Link to PDF page{pdf.hash ? ` ${pdf.page}` : ''}<kbd>{mod}Shift+L</kbd>
      </button>
      {#if anyRef}<button role="menuitem" onclick={run(() => unlinkPdf([...selected]))}>Remove PDF link</button>{/if}
    {/if}
    <hr />
    <button role="menuitem" onclick={run(() => copySelection('markdown'))}>Copy as Markdown<kbd>{mod}Shift+M</kbd></button>
    <button role="menuitem" onclick={run(() => copySelection('text'))}>Copy as plain text<kbd>{mod}Shift+T</kbd></button>
    <button role="menuitem" onclick={run(() => copySelection('image'))}>Copy as image<kbd>{mod}Shift+I</kbd></button>
    <hr />
    <button role="menuitem" class="danger" onclick={run(deleteSelected)}>Delete<kbd>Del</kbd></button>
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 70;
    min-width: 230px;
    padding: 5px;
    background: var(--chrome);
    border: 1px solid var(--border);
    border-radius: 9px;
    box-shadow: var(--shadow);
  }
  .group {
    padding: 4px 9px 3px;
    font-size: 10px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
  }
  button {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    gap: 18px;
    padding: 5px 9px;
    background: none;
    border: 0;
    border-radius: 6px;
    text-align: left;
  }
  button:hover:not(:disabled) {
    background: var(--accent-soft);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button.on::before {
    content: '✓';
    margin-right: -10px;
    color: var(--accent);
  }
  button.danger {
    color: #d1493b;
  }
  kbd {
    font-size: 10px;
    color: var(--muted);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 5px 2px;
  }
</style>
