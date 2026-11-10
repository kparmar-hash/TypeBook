<script lang="ts">
  import { PAGE_W, TOP, lineHeightOf, liveBlocks } from './app.svelte';
  import type { Notebook, Page } from './types';

  let { page, nb }: { page: Page; nb: Notebook } = $props();

  const W = 176;
  const H = 130;
  const scale = W / PAGE_W;
  const L = $derived(lineHeightOf(nb));

  /** Rough "ink" footprint of each text line, enough to recognise a page at a glance. */
  const bars = $derived(
    liveBlocks(page)
      .filter((b) => b.y * scale < H)
      .flatMap((b) =>
        b.text.split('\n').map((line, i) => ({
          x: b.x * scale,
          y: (b.y + i * L + L * 0.35) * scale,
          w: Math.min(line.length * nb.fontSize * 0.42, PAGE_W - b.x - 40) * scale,
          ink: b.ink,
        })),
      )
      .filter((r) => r.w > 0 && r.y < H),
  );
</script>

<svg width={W} height={H} viewBox="0 0 {W} {H}" aria-hidden="true">
  <rect width={W} height={H} fill="var(--paper)" />
  {#if page.title}<rect x={28 * scale} y={(TOP / 2) * scale} width={Math.min(page.title.length * 5, 90)} height="3" rx="1.5" fill="var(--muted)" opacity="0.5" />{/if}
  {#each bars as r}
    <rect x={r.x} y={r.y} width={r.w} height={Math.max(2, L * 0.28 * scale)} rx="1" fill="var(--ink-{r.ink})" opacity="0.75" />
  {/each}
</svg>
