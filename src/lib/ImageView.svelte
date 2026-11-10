<script lang="ts">
  import { IMAGE_WIDTH, imageSrc } from './app.svelte';
  import type { ImageItem } from './types';

  let {
    img,
    nbId,
    isSelected = false,
    readonly = false,
    ongrab,
    oncontext,
  }: {
    img: ImageItem;
    nbId: string;
    isSelected?: boolean;
    readonly?: boolean;
    ongrab?: (e: MouseEvent, id: string) => void;
    oncontext?: (e: MouseEvent, id: string) => void;
  } = $props();

  let src = $state('');
  let failed = $state(false);

  $effect(() => {
    failed = false;
    imageSrc(nbId, img.asset).then(
      (s) => (src = s),
      () => (failed = true),
    );
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="item image"
  class:selected={isSelected}
  data-item
  data-id={img.id}
  style="left:{img.x}px; top:{img.y}px; width:{IMAGE_WIDTH[img.size]}px"
  oncontextmenu={(e) => {
    if (readonly) return;
    e.preventDefault();
    oncontext?.(e, img.id);
  }}
>
  {#if !readonly}
    <button class="grab" tabindex="-1" aria-label="Move image" onmousedown={(e) => ongrab?.(e, img.id)}></button>
  {/if}
  {#if failed}
    <div class="missing">Image not found (still syncing?)</div>
  {:else if src}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <img {src} alt="" draggable="false" onmousedown={(e) => !readonly && ongrab?.(e, img.id)} />
  {:else}
    <div class="missing loading">Loading…</div>
  {/if}
</div>

<style>
  .item {
    position: absolute;
    border-radius: 3px;
  }
  .item.selected {
    outline: 1.5px dashed var(--accent);
    outline-offset: 2px;
    background: var(--accent-soft);
  }
  img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 2px;
    cursor: grab;
  }
  .grab {
    position: absolute;
    left: -20px;
    top: 0;
    width: 20px;
    height: 28px;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: grab;
    opacity: 0;
  }
  .grab::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 8px;
    width: 10px;
    height: 12px;
    background: radial-gradient(circle, var(--muted) 1.2px, transparent 1.6px) 0 0 / 5px 4px;
  }
  .item:hover .grab,
  .item.selected .grab {
    opacity: 1;
  }
  .missing {
    padding: 14px;
    border: 1px dashed var(--border);
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }
</style>
