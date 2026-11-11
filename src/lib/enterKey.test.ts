// @vitest-environment happy-dom
/** The real editor component, driven by real key events: Enter starts a new block, Shift+Enter does not. */
import { mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  app, createBlockAt, createNotebook, createPage, curNb, curPage, finishEdit, lineHeightOf, liveBlocks, openStore, selectPage, setBlockText, undo,
} from './app.svelte';
import BlockView from './BlockView.svelte';
import { MemoryStore } from './memStore';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let mounted: ReturnType<typeof mount> | null = null;

beforeAll(async () => {
  await openStore(new MemoryStore(), 'test');
  await createNotebook('N');
});
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
  finishEdit();
  document.body.innerHTML = '';
  app.snap = true;
});

/** A block being edited, with the real editor mounted on it and the caret at `caret` (default: the end). */
async function start(text: string, caret = text.length) {
  createPage();
  selectPage(curPage()!.id);
  createBlockAt(120, 200);
  const block = curPage()!.blocks.at(-1)!;
  setBlockText(block, text);
  mounted = mount(BlockView, { target: document.body, props: { block, editing: true, isSelected: false, maxWidth: 700 } });
  await sleep(10);
  const ta = document.querySelector('textarea') as HTMLTextAreaElement;
  ta.setSelectionRange(caret, caret);
  return { block, ta };
}

async function press(ta: HTMLTextAreaElement, init: KeyboardEventInit = { key: 'Enter' }) {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  ta.dispatchEvent(ev);
  await sleep(30); // the split waits a tick for the block to shrink
  return ev;
}

const L = () => lineHeightOf(curNb()!);
const TOP = 64;

describe('Enter starts a new block', () => {
  it('below the current one, at the same left edge, with the caret in it', async () => {
    const { block, ta } = await start('first line');
    const ev = await press(ta);
    const blocks = liveBlocks(curPage()!);
    expect(ev.defaultPrevented).toBe(true);
    expect(blocks).toHaveLength(2);
    const fresh = blocks[1];
    expect(block.text).toBe('first line');
    expect(fresh.x).toBe(block.x);
    expect(fresh.y).toBeGreaterThanOrEqual(block.y + L());
    expect((fresh.y - TOP) % L()).toBe(0); // on the ruled grid, never overlapping the block above
    expect(app.editingId).toBe(fresh.id);
    expect(fresh.text).toBe('');
  });

  it('lands exactly one line down when snapping is off', async () => {
    app.snap = false;
    const { block, ta } = await start('x');
    await press(ta);
    expect(liveBlocks(curPage()!)[1].y).toBe(block.y + L());
  });

  it('splits at the caret: the rest of the text moves to the new block', async () => {
    const { block, ta } = await start('hello world', 5);
    await press(ta);
    const blocks = liveBlocks(curPage()!);
    expect(block.text).toBe('hello');
    expect(blocks[1].text).toBe('world');
    expect(app.caret).toBe(0); // caret at the start of the moved text
    expect(app.editingId).toBe(blocks[1].id);
  });

  it('pressing Enter on an empty block just moves down a line without leaving an empty block behind', async () => {
    const { block, ta } = await start('');
    await press(ta);
    const blocks = liveBlocks(curPage()!);
    expect(blocks.filter((b) => b.text === '' && b.id !== app.editingId)).toHaveLength(0);
    expect(blocks.some((b) => b.id === block.id)).toBe(false);
    expect(blocks[0].y).toBeGreaterThan(block.y);
  });

  it('can be repeated: each Enter adds the next block down the page', async () => {
    const { ta } = await start('one');
    await press(ta);
    // type into the new block as the user would, then Enter again
    const second = curPage()!.blocks.find((b) => b.id === app.editingId)!;
    setBlockText(second, 'two');
    unmount(mounted!);
    mounted = mount(BlockView, { target: document.body, props: { block: second, editing: true, isSelected: false, maxWidth: 700 } });
    await sleep(10);
    const ta2 = document.querySelector('textarea') as HTMLTextAreaElement;
    ta2.setSelectionRange(3, 3);
    await press(ta2);
    const ys = liveBlocks(curPage()!).map((b) => b.y);
    expect(ys).toHaveLength(3);
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
  });

  it('is its own undo step, so Undo removes the new block and keeps the first', async () => {
    const { block, ta } = await start('keep me');
    await press(ta);
    const fresh = curPage()!.blocks.find((b) => b.id === app.editingId)!;
    setBlockText(fresh, 'typed in the second block');
    finishEdit();
    undo();
    expect(liveBlocks(curPage()!).map((b) => b.text)).toEqual([block.text]);
  });

  it('does not end the new block when the old editor loses focus afterwards', async () => {
    const { ta } = await start('abc');
    await press(ta);
    const newId = app.editingId;
    ta.dispatchEvent(new FocusEvent('blur'));
    await sleep(10);
    expect(app.editingId).toBe(newId);
  });
});

describe('Enter stays inside the block when it has to', () => {
  it('Shift+Enter is an ordinary line break (left to the browser)', async () => {
    const { block, ta } = await start('one');
    const ev = await press(ta, { key: 'Enter', shiftKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(liveBlocks(curPage()!)).toHaveLength(1);
    expect(app.editingId).toBe(block.id);
  });

  it('while typing a code fence, so a fence can actually be written', async () => {
    const { block, ta } = await start('```python');
    const ev = await press(ta);
    expect(ev.defaultPrevented).toBe(true);
    expect(liveBlocks(curPage()!)).toHaveLength(1);
    expect(ta.value).toBe('```python\n');
    expect(block.text).toBe('```python\n');
  });

  it('inside code it keeps the indentation', async () => {
    const { block, ta } = await start('```js\nif (x) {\n  y();');
    await press(ta);
    expect(block.text).toBe('```js\nif (x) {\n  y();\n  ');
    expect(liveBlocks(curPage()!)).toHaveLength(1);
  });

  it('inside a $$ math block that is not closed yet', async () => {
    const { block, ta } = await start('$$\\begin{aligned} a &= b \\\\');
    await press(ta);
    expect(liveBlocks(curPage()!)).toHaveLength(1);
    expect(block.text.endsWith('\n')).toBe(true);
  });

  it('but once the fence or the math is closed, Enter starts a new block again', async () => {
    const { ta } = await start('```js\nx()\n```');
    await press(ta);
    expect(liveBlocks(curPage()!)).toHaveLength(2);
  });

  it('ignores Enter while an input method (IME) is composing', async () => {
    const { ta } = await start('こんにちは');
    const ev = await press(ta, { key: 'Enter', isComposing: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(liveBlocks(curPage()!)).toHaveLength(1);
  });
});
