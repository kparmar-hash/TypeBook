<script lang="ts">
  import { PAGE_W, RIGHT_MARGIN, app } from './app.svelte';
  import BlockView from './BlockView.svelte';
  import ImageView from './ImageView.svelte';
  import SheetSurface from './SheetSurface.svelte';
  import type { Notebook, Page, Paper } from './types';

  /** Static, read-only rendering of a page (or a subset of its items) for export. */
  let {
    page,
    nb,
    paper,
    only = null,
  }: { page: Page; nb: Notebook; paper: Paper; only?: Set<string> | null } = $props();

  const blocks = $derived(page.blocks.filter((b) => !b.deleted && (!only || only.has(b.id))));
  const images = $derived(page.images.filter((i) => !i.deleted && (!only || only.has(i.id))));
</script>

<SheetSurface {nb} {paper} title={only ? '' : page.title} minHeight={0}>
  {#each blocks as b (b.id)}
    <BlockView block={b} readonly maxWidth={Math.max(120, PAGE_W - b.x - RIGHT_MARGIN)} />
  {/each}
  {#each images as img (img.id)}
    <ImageView {img} nbId={app.nbId ?? ''} readonly />
  {/each}
</SheetSurface>
