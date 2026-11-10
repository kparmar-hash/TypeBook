<script lang="ts">
  import type { Snippet } from 'svelte';
  import { MARGIN_X, PAGE_W, TOP, lineHeightOf } from './app.svelte';
  import { FONTS } from './fonts';
  import type { Notebook, Paper } from './types';

  let {
    nb,
    title = '',
    paper,
    minHeight = 1100,
    el = $bindable(),
    onmousedown,
    onmousemove,
    onmouseleave,
    children,
  }: {
    nb: Notebook;
    title?: string;
    paper: Paper;
    minHeight?: number;
    el?: HTMLDivElement;
    onmousedown?: (e: MouseEvent) => void;
    onmousemove?: (e: MouseEvent) => void;
    onmouseleave?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="sheet paper-{paper}"
  class:margin={nb.margin && paper === 'ruled'}
  bind:this={el}
  {onmousedown}
  {onmousemove}
  {onmouseleave}
  style="--L:{lineHeightOf(nb)}px; --top:{TOP}px; --fs:{nb.fontSize}px; --font:{FONTS[nb.font].css}; --margin-x:{MARGIN_X}px; width:{PAGE_W}px; min-height:{minHeight}px"
>
  {#if title}<div class="title">{title}</div>{/if}
  {@render children()}
</div>

<style>
  .sheet {
    position: relative;
    background-color: var(--paper);
    border-radius: 3px;
    cursor: text;
    background-position: 0 var(--top);
    background-size: 100% var(--L);
  }
  .paper-ruled {
    background-image: linear-gradient(transparent calc(var(--L) - 1px), var(--rule) calc(var(--L) - 1px));
  }
  .paper-grid {
    background-image:
      linear-gradient(transparent calc(var(--L) - 1px), var(--rule) calc(var(--L) - 1px)),
      linear-gradient(90deg, transparent calc(var(--L) - 1px), var(--rule) calc(var(--L) - 1px));
    background-size: var(--L) var(--L);
  }
  .paper-dots {
    background-image: radial-gradient(circle at 50% calc(100% - 1px), var(--rule) 1.4px, transparent 2px);
    background-size: var(--L) var(--L);
  }
  .margin::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--margin-x);
    width: 1px;
    background: var(--margin-line);
    pointer-events: none;
  }
  .title {
    position: absolute;
    left: 28px;
    top: 14px;
    font-family: var(--font);
    font-size: calc(var(--fs) * 1.1);
    color: var(--muted);
    opacity: 0.6;
    pointer-events: none;
    user-select: none;
  }
</style>
