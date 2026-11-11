<script lang="ts">
  import { app, beginEdit, finishEdit, setBlockText } from './app.svelte';
  import { openRef } from './pdfDoc';
  import { CODE_INDENT, codeEnter, codeOutdent, insideCode, rawOffsetInLine, renderBlock } from './markup';
  import type { Block } from './types';

  let {
    block,
    editing,
    isSelected,
    maxWidth,
    readonly = false,
    ongrab,
    oncontext,
  }: {
    block: Block;
    editing?: boolean;
    isSelected?: boolean;
    maxWidth: number;
    readonly?: boolean;
    ongrab?: (e: MouseEvent, id: string) => void;
    oncontext?: (e: MouseEvent, id: string) => void;
  } = $props();

  const LABELS: Record<string, string> = { definition: 'Definition', theorem: 'Theorem', exercise: 'Exercise', note: 'Note' };

  let viewEl = $state<HTMLDivElement>();

  const html = $derived(renderBlock(block.text));

  /** Raw-text offset matching the clicked spot in the rendered block. */
  function caretFromPoint(e: MouseEvent): number | null {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    let node: Node | null = null;
    let off = 0;
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(e.clientX, e.clientY);
      node = p?.offsetNode ?? null;
      off = p?.offset ?? 0;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(e.clientX, e.clientY);
      node = r?.startContainer ?? null;
      off = r?.startOffset ?? 0;
    }
    if (!node || !viewEl) return null;
    const el = node instanceof Element ? node : node.parentElement;
    const line = el?.closest<HTMLElement>('.ln');
    if (!el || !line || !viewEl.contains(line)) return null;
    const start = Number(line.dataset.s);
    const end = Number(line.dataset.e);
    if (line.classList.contains('cb')) {
      // inside a code block: caret at the clicked character of the code itself
      const code = line.querySelector('code');
      if (!code || !code.contains(node)) return end;
      const r = document.createRange();
      r.setStart(code, 0);
      r.setEnd(node, off);
      return Number(line.dataset.cs) + r.toString().length;
    }
    if (node.nodeType !== Node.TEXT_NODE || el.closest('.katex') || line.classList.contains('dm')) return end;
    let count = 0;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (t.parentElement?.closest('.mk, .katex')) continue;
      if (t === node) {
        count += off;
        break;
      }
      count += t.textContent?.length ?? 0;
    }
    return start + rawOffsetInLine(block.text.slice(start, end), count);
  }

  function viewDown(e: MouseEvent) {
    if (readonly || e.button !== 0 || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    beginEdit(block.id, caretFromPoint(e));
  }

  function mountEditor(node: HTMLTextAreaElement) {
    node.focus({ preventScroll: true });
    const caret = app.caret ?? node.value.length;
    node.setSelectionRange(caret, caret);
  }

  /** Type into the textarea the way the user would, so it counts as input (and the app sees it). */
  function insertText(ta: HTMLTextAreaElement, text: string) {
    if (!document.execCommand?.('insertText', false, text)) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishEdit();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    // Inside a fenced code block, Tab indents and Enter keeps the indentation (otherwise Tab would leave the box).
    const ta = e.currentTarget as HTMLTextAreaElement;
    const pos = ta.selectionStart;
    if (e.key === 'Enter' && !e.shiftKey && pos === ta.selectionEnd) {
      const ins = codeEnter(ta.value, pos);
      if (ins) {
        e.preventDefault();
        insertText(ta, ins);
      }
    } else if (e.key === 'Tab' && insideCode(ta.value, pos)) {
      e.preventDefault();
      if (!e.shiftKey) insertText(ta, CODE_INDENT);
      else {
        const cut = codeOutdent(ta.value, pos);
        if (cut) {
          ta.setSelectionRange(cut.from, cut.to);
          if (!document.execCommand?.('delete')) {
            ta.setRangeText('', cut.from, cut.to, 'end');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="block"
  class:editing
  class:selected={isSelected}
  data-item
  data-id={block.id}
  data-style={block.style}
  data-label={LABELS[block.style] ?? ''}
  style="left:{block.x}px; top:{block.y}px; max-width:{maxWidth}px; color:var(--ink-{block.ink})"
  oncontextmenu={(e) => {
    if (readonly) return;
    e.preventDefault();
    oncontext?.(e, block.id);
  }}
>
  {#if !readonly}
    <button class="grab" tabindex="-1" aria-label="Move block" onmousedown={(e) => ongrab?.(e, block.id)}></button>
  {/if}
  {#if block.ref && !readonly}
    <button
      class="ref"
      tabindex="-1"
      title="{app.pdfs[block.ref.pdf]?.name ?? 'PDF'} — open page {block.ref.page}"
      onmousedown={(e) => e.stopPropagation()}
      onclick={() => openRef(block.ref!)}>p.{block.ref.page}</button
    >
  {/if}
  {#if editing}
    <div class="sizer">
      <div class="mirror" aria-hidden="true">{block.text}&#8203;</div>
      <textarea
        use:mountEditor
        value={block.text}
        rows="1"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        oninput={(e) => setBlockText(block, e.currentTarget.value)}
        onkeydown={key}
        onblur={() => document.hasFocus() && finishEdit()}
      ></textarea>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="view" bind:this={viewEl} onmousedown={viewDown}>{@html html}</div>
  {/if}
</div>

<style>
  .block {
    position: absolute;
    width: max-content;
    min-width: 0.6em;
    font-family: var(--font);
    font-size: var(--fs);
    line-height: var(--L);
    border-radius: 3px;
  }
  .block.selected {
    outline: 1.5px dashed var(--accent);
    outline-offset: 2px;
    background: var(--accent-soft);
  }
  .block.editing {
    outline: 1px solid var(--accent-soft);
    outline-offset: 2px;
  }
  /* block styles: a left bar, a small label and a tint; padding is horizontal only so lines stay on the grid */
  .block[data-style='heading'] {
    font-size: calc(var(--fs) * 1.3);
    font-weight: 600;
  }
  .block[data-style='definition'],
  .block[data-style='theorem'],
  .block[data-style='exercise'],
  .block[data-style='note'] {
    padding: 0 10px 0 10px;
    border-left: 3px solid var(--sty);
    background: color-mix(in srgb, var(--sty) 9%, transparent);
    border-radius: 2px 4px 4px 2px;
  }
  .block[data-style='definition'] {
    --sty: #3b78d8;
  }
  .block[data-style='theorem'] {
    --sty: #b5533f;
  }
  .block[data-style='exercise'] {
    --sty: #2f8f55;
  }
  .block[data-style='note'] {
    --sty: #b8892b;
  }
  .block[data-label]:not([data-label='']):before {
    content: attr(data-label);
    position: absolute;
    top: -13px;
    left: 8px;
    font: 600 10px/1 var(--ui-font);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sty);
    pointer-events: none;
  }
  .block[data-style='quote'] {
    color: var(--ink-pencil) !important;
    font-style: italic;
    padding: 0 10px;
    border-left: 3px solid var(--ink-pencil);
  }
  .block.selected {
    background-color: var(--accent-soft);
  }
  .ref {
    position: absolute;
    right: 0;
    top: -13px;
    padding: 1px 5px;
    font: 600 10px/1.3 var(--ui-font);
    font-style: normal;
    color: var(--accent);
    background: var(--chrome);
    border: 1px solid var(--accent-soft);
    border-radius: 3px;
    opacity: 0.85;
  }
  .ref:hover {
    opacity: 1;
    border-color: var(--accent);
  }
  .grab {
    position: absolute;
    left: -20px;
    top: 0;
    width: 20px;
    height: min(var(--L), 28px);
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
    top: calc(50% - 6px);
    width: 10px;
    height: 12px;
    background: radial-gradient(circle, var(--muted) 1.2px, transparent 1.6px) 0 0 / 5px 4px;
  }
  .block:hover .grab,
  .block.selected .grab,
  .grab:focus-visible {
    opacity: 1;
  }
  .grab:active {
    cursor: grabbing;
  }
  .view {
    cursor: text;
    width: max-content;
    max-width: inherit;
    padding-right: 2px;
  }
  .sizer {
    position: relative;
    width: max-content;
    max-width: inherit;
  }
  .mirror {
    visibility: hidden;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    padding-right: 2px;
    min-height: var(--L);
  }
  textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0 2px 0 0;
    border: 0;
    outline: 0;
    resize: none;
    overflow: hidden;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: inherit;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }

  .view :global(.ln) {
    min-height: var(--L);
    overflow-wrap: break-word;
  }
  .view :global(.li) {
    display: flex;
    gap: 0.4em;
  }
  .view :global(.li .mk) {
    flex: none;
    min-width: 1em;
    opacity: 0.8;
  }
  .view :global(.dm .katex-display) {
    margin: 0.2em 0;
  }
  .view :global(.katex) {
    font-size: 1.02em;
    line-height: 1.2;
  }
  /* fenced code block: monospace, indentation kept, scrolls sideways instead of wrapping; no vertical padding so
     later lines stay on the ruled grid */
  .view :global(.cb) {
    position: relative;
    margin: 0;
  }
  .view :global(.cb pre) {
    margin: 0;
    padding: 0 10px;
    font-family: var(--mono-font);
    font-size: 0.72em;
    line-height: var(--L); /* one ruled line per code line, whatever the font size */
    white-space: pre;
    overflow-x: auto;
    tab-size: 2;
    background: var(--code-bg);
    border-radius: 4px;
  }
  .view :global(.cb code) {
    font: inherit;
    background: none;
    padding: 0;
  }
  .view :global(.cb-lang) {
    position: absolute;
    top: 1px;
    right: 6px;
    z-index: 1;
    font: 600 9px/1 var(--ui-font);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    opacity: 0.8;
    pointer-events: none;
  }
  .view :global(code) {
    font-family: var(--mono-font);
    font-size: 0.8em;
    background: var(--code-bg);
    padding: 0 0.3em;
    border-radius: 3px;
  }
  .view :global(mark) {
    background: var(--mark);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
