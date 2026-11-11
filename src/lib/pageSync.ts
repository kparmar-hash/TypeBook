import { differs } from './canonical';
import { scrubBlock, scrubNotebook, scrubPage } from './tombstones';
import type { Notebook, Page } from './types';

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * A page reduced to what is actually stored and shared, so two copies can be compared for real differences:
 *  - blocks and images in id order (a database returns them sorted; the app keeps creation order, and ids made in
 *    the same millisecond are not ordered, so the two routinely disagree about order alone),
 *  - no empty blocks that are still being typed into (they are never saved),
 *  - deleted content emptied the way the server empties it.
 */
export function normalizePage(p: Page): Page {
  const s = scrubPage({ ...p, images: p.images ?? [], blocks: (p.blocks ?? []).filter((b) => b.deleted || b.text !== '') });
  return { ...s, blocks: byId(s.blocks), images: byId(s.images) };
}

export const pageDiffers = (a: Page, b: Page) => differs(normalizePage(a), normalizePage(b));

/**
 * Compare notebooks. A page id that is no longer a live page is ignored in the page order: a server that merges
 * orders by union keeps handing back ids of deleted pages, and treating that as a difference makes the app and
 * the server undo each other's change forever.
 */
export function notebookDiffers(a: Notebook, b: Notebook, livePages?: ReadonlySet<string>) {
  const norm = (n: Notebook) => {
    const s = scrubNotebook(n);
    return livePages ? { ...s, pageOrder: s.pageOrder.filter((id) => livePages.has(id)) } : s;
  };
  return differs(norm(a), norm(b));
}

function patchItems<T extends { id: string }>(list: T[], next: T[], same: (a: T, b: T) => boolean) {
  const have = new Map(list.map((i) => [i.id, i]));
  for (const n of next) {
    const cur = have.get(n.id);
    if (!cur) list.push({ ...n });
    else if (!same(cur, n)) {
      for (const k of Object.keys(cur)) if (!(k in n)) delete (cur as Record<string, unknown>)[k];
      Object.assign(cur, n);
    }
  }
}

/**
 * Bring `p` up to date with `next` (which must already contain everything `p` has, i.e. a merge that included it),
 * changing only what actually differs and editing objects in place. Nothing is replaced, removed or reordered, so a
 * textarea being typed into keeps its focus, a selection stays, and blocks not yet saved are never lost.
 */
export function patchPage(p: Page, next: Page) {
  if (p.paper !== next.paper) p.paper = next.paper;
  if (p.updatedAt !== next.updatedAt) p.updatedAt = next.updatedAt;
  if (!!p.deleted !== !!next.deleted) {
    if (next.deleted) p.deleted = true;
    else delete p.deleted;
  }
  // A deleted page arrives emptied. Keep our copy of its content so Undo can bring it back.
  if (next.deleted) return;
  if (p.title !== next.title) p.title = next.title;
  if (differs(p.tags, next.tags)) p.tags = [...next.tags];
  p.images ??= [];
  patchItems(p.blocks, next.blocks, (a, b) => !differs(scrubBlock(a), scrubBlock(b)));
  patchItems(p.images, next.images ?? [], (a, b) => !differs(a, b));
}
