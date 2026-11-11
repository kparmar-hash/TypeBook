// @vitest-environment happy-dom
/**
 * The real app state (app.svelte.ts) driven against the real database logic, with a simulated realtime channel
 * that echoes every write back to every device, exactly as Supabase Realtime does. Guards against the two
 * failure modes seen in practice: endless save/echo loops, and a merge result overwriting what you just typed.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  app, createBlockAt, createPage, curNb, curPage, deleteSelected, finishEdit, flush, liveBlocks, openStore,
  selectNotebook, selectPage, selected, setBlockText, visiblePages, createNotebook, deletePage, duplicatePage, undo, beginEdit,
} from '../src/lib/app.svelte';
import { pageDiffers } from '../src/lib/pageSync';
import { SupabaseStore } from '../src/lib/supabaseStore';
import { ALICE, newDb } from './harness';
import { PgRemote } from './pgRemote';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let db: PGlite;

/** Every device of one user hears every write (their own included), like Realtime. */
class Bus {
  devices: Remote2[] = [];
  counts = { savePage: 0, saveNotebook: 0 };
}
class Remote2 extends PgRemote {
  constructor(db: PGlite, uid: string, private bus: Bus) {
    super(db, uid);
    bus.devices.push(this);
  }
  async rpc(fn: string, a: Record<string, unknown>) {
    const out = await super.rpc(fn, a);
    if (fn === 'save_page') {
      this.bus.counts.savePage++;
      const id = (a.p_page as { id: string }).id;
      setTimeout(async () => {
        const [row] = await super.select('pages', { eq: { id } });
        for (const d of this.bus.devices) d.emitRow('pages', row);
      }, 20);
    } else if (fn === 'save_notebook') {
      this.bus.counts.saveNotebook++;
      const id = (a.p_notebook as { id: string }).id;
      setTimeout(async () => {
        const [row] = await super.select('notebooks', { eq: { id } });
        for (const d of this.bus.devices) d.emitRow('notebooks', row);
      }, 20);
    }
    return out;
  }
}

const type = (text: string, x = 120, y = 200) => {
  createBlockAt(x, y);
  setBlockText(curPage()!.blocks.at(-1)!, text);
  finishEdit();
};
const texts = () => liveBlocks(curPage()!).map((b) => b.text);
/** saves made while the app sits idle for `ms` */
async function idleSaves(bus: Bus, ms: number) {
  const before = { ...bus.counts };
  await sleep(ms);
  const n = { savePage: bus.counts.savePage - before.savePage, saveNotebook: bus.counts.saveNotebook - before.saveNotebook };
  if (n.savePage + n.saveNotebook) console.log('idle saves:', JSON.stringify(n));
  return n.savePage + n.saveNotebook;
}

let bus: Bus;
let me: Remote2;

beforeAll(async () => {
  db = await newDb();
  bus = new Bus();
  me = new Remote2(db, ALICE, bus);
  await openStore(new SupabaseStore(me), 'test');
  await createNotebook('Thesis');
}, 60_000);

describe('saving settles instead of looping', () => {
  it('goes quiet after a burst of typing and deleting', async () => {
    type('first');
    type('second', 120, 300);
    createPage();
    type('on page two');
    await flush();
    await sleep(600);
    expect(await idleSaves(bus, 2500)).toBe(0);
  }, 30_000);

  it('goes quiet after deleting a page (its id is dropped from the notebook order)', async () => {
    const before = visiblePages().length;
    deletePage(visiblePages().at(-1)!.id);
    await flush();
    await sleep(600);
    expect(visiblePages().length).toBe(before - 1);
    expect(await idleSaves(bus, 2500)).toBe(0);
  }, 30_000);

  it('goes quiet after duplicating pages (new blocks get ids created in the same millisecond)', async () => {
    selectPage(visiblePages()[0].id);
    for (let i = 0; i < 3; i++) type(`dup source ${i}`, 120, 120 + i * 40);
    duplicatePage(visiblePages()[0].id);
    await flush();
    await sleep(600);
    expect(await idleSaves(bus, 2500)).toBe(0);
  }, 30_000);
});

describe('what you type is never lost, reverted or interrupted', () => {
  const MERGED = 'Merged changes from another device';
  const block = (id: string) => curPage()!.blocks.find((b) => b.id === id);

  it('keeps every keystroke and keeps the block in edit mode while saves and echoes land mid-typing', async () => {
    selectPage(visiblePages()[0].id);
    createBlockAt(120, 500);
    const id = curPage()!.blocks.at(-1)!.id;
    let text = '';
    for (let i = 0; i < 70; i++) {
      text += String.fromCharCode(97 + (i % 26));
      expect(block(id), `block vanished after ${i} keystrokes`).toBeDefined();
      setBlockText(block(id)!, text);
      expect(app.editingId, `editing was interrupted after ${i} keystrokes`).toBe(id);
      await sleep(60); // long enough that a debounced save, its reply and its echo arrive in between
    }
    for (let i = 0; i < 40; i++) {
      text = text.slice(0, -1);
      expect(block(id), `block vanished while deleting (${i})`).toBeDefined();
      setBlockText(block(id)!, text);
      expect(app.editingId).toBe(id);
      await sleep(60);
    }
    expect(block(id)!.text).toBe(text);
    finishEdit();
    await flush();
    await sleep(800);
    expect(block(id)!.text).toBe(text);
    expect(app.toasts.some((t) => t.text === MERGED), 'a "merged from another device" toast appeared with only one device').toBe(false);
  }, 60_000);

  it('does not bring back a block you deleted, even when another device still has it', async () => {
    const other = new SupabaseStore(new Remote2(db, ALICE, bus));
    selectPage(visiblePages()[0].id);
    type('delete me', 120, 600);
    const victim = curPage()!.blocks.at(-1)!;
    await flush();
    await sleep(300);
    const stale = JSON.parse(JSON.stringify(curPage()));            // what the other device still holds
    selected.clear();
    selected.add(victim.id);
    deleteSelected();
    await flush();
    await sleep(300);
    for (let i = 0; i < 10; i++) {                                    // the other device keeps saving its old copy
      await other.savePage(curNb()!.id, { ...stale, updatedAt: new Date().toISOString() });
      await sleep(120);
      expect(block(victim.id)?.deleted, `block came back on attempt ${i + 1}`).toBe(true);
    }
    expect(texts()).not.toContain('delete me');
  }, 60_000);

  it('takes in a real change from another device without losing local typing, then settles', async () => {
    const other = new SupabaseStore(new Remote2(db, ALICE, bus));
    selectPage(visiblePages()[0].id);
    createBlockAt(120, 700);
    const id = curPage()!.blocks.at(-1)!.id;
    setBlockText(block(id)!, 'typing on this device');
    const remote = JSON.parse(JSON.stringify(curPage()));
    remote.blocks = [{ id: 'b_' + 'R'.repeat(26), x: 50, y: 50, text: 'written on the other device', style: 'normal', ink: 'blue', updatedAt: new Date().toISOString(), deleted: false }];
    await other.savePage(curNb()!.id, { ...remote, updatedAt: new Date().toISOString() });
    await sleep(300);
    setBlockText(block(id)!, 'typing on this device, still going');   // keeps typing after the other device's change arrived
    expect(app.editingId).toBe(id);
    finishEdit();
    await flush();
    await sleep(800);
    expect(texts()).toContain('written on the other device');
    expect(texts()).toContain('typing on this device, still going');
    expect(await idleSaves(bus, 2500)).toBe(0);
  }, 60_000);
});

describe('a save never shuffles or replaces what is on screen', () => {
  it('keeps block order and the very same objects after duplicating a page (ids made in one millisecond are unordered)', async () => {
    await sleep(500);
    app.toasts.length = 0; // earlier tests legitimately merged another device's change
    selectPage(visiblePages()[0].id);
    for (let i = 0; i < 4; i++) type(`source ${i}`, 120, 100 + i * 40);
    duplicatePage(visiblePages()[0].id);
    const before = curPage()!.blocks.map((b) => b);
    const order = before.map((b) => b.id);
    expect([...order].sort().join(), 'precondition: ids not in sorted order').not.toBe(order.join()); // the case that used to misfire
    await flush();
    await sleep(800);
    expect(curPage()!.blocks.map((b) => b.id)).toEqual(order);          // no reordering, so a focused textarea is never moved
    curPage()!.blocks.forEach((b, i) => expect(b).toBe(before[i]));     // no replaced objects either
    expect(app.toasts.some((t) => t.text === 'Merged changes from another device')).toBe(false);
  }, 30_000);

  it('does not shake the block you are editing when a save completes (focus, selection and edit mode survive)', async () => {
    selectPage(visiblePages()[0].id);
    for (let i = 0; i < 3; i++) type(`neighbour ${i}`, 400, 100 + i * 40);
    createBlockAt(120, 700);
    const id = curPage()!.blocks.at(-1)!.id;
    setBlockText(curPage()!.blocks.find((b) => b.id === id)!, 'typing');
    selected.add(curPage()!.blocks[0].id); // something selected too
    const sel = curPage()!.blocks[0].id;
    await flush();                          // a save and its echo happen right now, mid-edit
    await sleep(500);
    expect(app.editingId).toBe(id);
    expect(selected.has(sel)).toBe(true);
    expect(curPage()!.blocks.find((b) => b.id === id)!.text).toBe('typing');
    finishEdit();
    selected.clear();
  }, 30_000);

  it('does not announce a merge after Undo', async () => {
    selectPage(visiblePages()[0].id);
    app.toasts.length = 0;
    beginEdit(curPage()!.blocks.find((b) => !b.deleted)!.id);
    setBlockText(curPage()!.blocks.find((b) => b.id === app.editingId)!, 'edited then undone');
    finishEdit();
    await flush();
    undo();
    await flush();
    await sleep(800);
    expect(app.toasts.some((t) => t.text === 'Merged changes from another device')).toBe(false);
    expect(await idleSaves(bus, 2000)).toBe(0);
  }, 30_000);
});

describe('two real devices editing at once converge and go quiet', () => {
  it('stay in step through typing, duplicating, deleting pages and blocks on both sides', async () => {
    vi.resetModules();
    const B = await import('../src/lib/app.svelte');               // a second, independent copy of the whole app
    await B.openStore(new SupabaseStore(new Remote2(db, ALICE, bus)), 'device-b');
    await B.selectNotebook(curNb()!.id);
    await sleep(500);

    // both devices work at the same moment
    selectPage(visiblePages()[0].id);
    B.selectPage(B.visiblePages()[0].id);
    for (let i = 0; i < 3; i++) {
      type(`from A ${i}`, 120, 100 + i * 40);
      B.createBlockAt(500, 100 + i * 40);
      B.setBlockText(B.curPage()!.blocks.at(-1)!, `from B ${i}`);
      B.finishEdit();
      await sleep(150);
    }
    duplicatePage(visiblePages()[0].id);
    B.deletePage(B.visiblePages().at(-1)!.id);
    await sleep(300);
    const victim = liveBlocks(curPage()!)[0];
    selected.clear();
    selected.add(victim.id);
    deleteSelected();
    await Promise.all([flush(), B.flush()]);
    await sleep(2500);

    // both devices hold the same pages and the same text everywhere
    expect(visiblePages().map((p) => p.id).sort()).toEqual(B.visiblePages().map((p) => p.id).sort());
    for (const pa of visiblePages()) {
      const pb = B.visiblePages().find((p) => p.id === pa.id)!;
      expect(pageDiffers(JSON.parse(JSON.stringify(pa)), JSON.parse(JSON.stringify(pb))), `page ${pa.id} differs between devices`).toBe(false);
    }
    expect(JSON.stringify(liveBlocks(curPage()!).map((b) => b.id)).includes(victim.id)).toBe(false); // the deleted block stayed deleted on A
    expect(await idleSaves(bus, 3000)).toBe(0);                    // and nothing keeps saving
  }, 90_000);
});
