<script lang="ts">
  import {
    MARGIN_X,
    PAGE_W,
    RIGHT_MARGIN,
    TOP,
    app,
    begin,
    commit,
    createBlockAt,
    curNb,
    curPage,
    finishEdit,
    lineHeightOf,
    liveBlocks,
    liveImages,
    moveBlocks,
    openMenu,
    paperOf,
    pointer,
    selected,
  } from './app.svelte';
  import BlockView from './BlockView.svelte';
  import ImageView from './ImageView.svelte';
  import SheetSurface from './SheetSurface.svelte';

  let sheetEl = $state<HTMLDivElement>();
  let marquee = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  let contentBottom = $state(0);

  const nb = $derived(curNb());
  const page = $derived(curPage());
  const L = $derived(nb ? lineHeightOf(nb) : 34);
  const paper = $derived(page && nb ? paperOf(page, nb) : 'ruled');
  const blocks = $derived(page ? liveBlocks(page) : []);
  const images = $derived(page ? liveImages(page) : []);

  // Sheet grows with its content; measured after layout, not per keystroke render.
  $effect(() => {
    page?.id;
    for (const b of blocks) {
      b.x;
      b.y;
      b.text;
      b.style;
    }
    for (const i of images) {
      i.x;
      i.y;
      i.size;
    }
    app.editingId;
    nb?.fontSize;
    nb?.font;
    const raf = requestAnimationFrame(() => {
      let bottom = 0;
      for (const el of sheetEl?.querySelectorAll<HTMLElement>('[data-item]') ?? [])
        bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
      contentBottom = bottom;
    });
    return () => cancelAnimationFrame(raf);
  });

  const snapY = (y: number) => TOP + Math.floor((y - TOP) / L) * L;

  function snapPoint(e: MouseEvent, x: number, y: number) {
    if (!app.snap || e.altKey) return { x, y: y - L / 2 };
    let sx = x;
    const cols = blocks.map((b) => b.x);
    if (nb?.margin && paper === 'ruled') cols.push(MARGIN_X + 10);
    let best = 14;
    for (const c of cols) {
      const d = Math.abs(c - x);
      if (d < best) {
        best = d;
        sx = c;
      }
    }
    return { x: sx, y: snapY(y) };
  }

  const local = (e: MouseEvent) => {
    const r = sheetEl!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function sheetDown(e: MouseEvent) {
    if (e.button !== 0 || e.target !== sheetEl) return;
    e.preventDefault();
    const { x, y } = local(e);
    if (e.ctrlKey || e.metaKey) return startMarquee(e, x, y);
    const p = snapPoint(e, x, y);
    createBlockAt(p.x, p.y);
  }

  function deskDown(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      finishEdit();
      selected.clear();
    }
  }

  function startMarquee(e: MouseEvent, x: number, y: number) {
    finishEdit();
    if (!e.shiftKey) selected.clear();
    const base = new Set(selected);
    marquee = { x0: x, y0: y, x1: x, y1: y };
    const move = (ev: MouseEvent) => {
      const p = local(ev);
      marquee = { ...marquee!, x1: p.x, y1: p.y };
      const l = Math.min(marquee.x0, marquee.x1);
      const r = Math.max(marquee.x0, marquee.x1);
      const t = Math.min(marquee.y0, marquee.y1);
      const b = Math.max(marquee.y0, marquee.y1);
      selected.clear();
      base.forEach((id) => selected.add(id));
      for (const el of sheetEl!.querySelectorAll<HTMLElement>('[data-item]')) {
        const ex = el.offsetLeft;
        const ey = el.offsetTop;
        if (ex < r && ex + el.offsetWidth > l && ey < b && ey + el.offsetHeight > t) selected.add(el.dataset.id!);
      }
    };
    const up = () => {
      marquee = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function trackPointer(e: MouseEvent) {
    const p = local(e);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.valid = true;
  }

  function context(e: MouseEvent, id: string) {
    if (!selected.has(id)) {
      finishEdit();
      selected.clear();
      selected.add(id);
    }
    openMenu(e.clientX, e.clientY, id);
  }

  function grab(e: MouseEvent, id: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    finishEdit();
    if (e.shiftKey) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    } else if (!selected.has(id)) {
      selected.clear();
      selected.add(id);
    }
    const sx = e.clientX;
    const sy = e.clientY;
    let lx = sx;
    let ly = sy;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      if (!moved) {
        moved = true;
        begin();
      }
      moveBlocks(selected, ev.clientX - lx, ev.clientY - ly);
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (!moved) return;
      if (app.snap && !ev.altKey) {
        const first = [...blocks, ...images].find((x) => selected.has(x.id));
        if (first && snapY(first.y) !== first.y) moveBlocks(selected, 0, snapY(first.y) - first.y);
      }
      commit();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="desk" onmousedown={deskDown}>
  {#if nb && page}
    <div class="shadow">
      <SheetSurface
        {nb}
        {paper}
        title={page.title}
        minHeight={Math.max(1100, contentBottom + 400)}
        bind:el={sheetEl}
        onmousedown={sheetDown}
        onmousemove={trackPointer}
      >
        {#each blocks as b (b.id)}
          <BlockView
            block={b}
            editing={app.editingId === b.id}
            isSelected={selected.has(b.id)}
            maxWidth={Math.max(120, PAGE_W - b.x - RIGHT_MARGIN)}
            ongrab={grab}
            oncontext={context}
          />
        {/each}
        {#each images as img (img.id)}
          <ImageView {img} nbId={nb.id} isSelected={selected.has(img.id)} ongrab={grab} oncontext={context} />
        {/each}
        {#if marquee}
          <div
            class="marquee"
            style="left:{Math.min(marquee.x0, marquee.x1)}px; top:{Math.min(marquee.y0, marquee.y1)}px; width:{Math.abs(marquee.x1 - marquee.x0)}px; height:{Math.abs(marquee.y1 - marquee.y0)}px"
          ></div>
        {/if}
      </SheetSurface>
    </div>
  {/if}
</div>

<style>
  .desk {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 20px 0 60px;
    background: var(--desk);
  }
  .shadow {
    width: fit-content;
    margin: 0 auto;
    box-shadow: var(--shadow);
    border-radius: 3px;
  }
  .marquee {
    position: absolute;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    pointer-events: none;
  }
</style>
