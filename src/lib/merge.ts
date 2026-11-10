import type { Library, Notebook, Page } from './types';

interface Item {
  id: string;
  updatedAt: string;
  deleted?: boolean;
}

/** Deterministic winner so merge(a,b) and merge(b,a) agree: newer wins, then tombstone, then content. */
function winner<T extends Item>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/** Merge two lists of id'd items: per-id winner, union of the rest. */
export function mergeItems<T extends Item>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of a) byId.set(item.id, item);
  for (const item of b) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? winner(existing, item) : item);
  }
  return [...byId.values()];
}

/**
 * Merge two versions of the same page. Blocks and images merge per id (newest `updatedAt` wins,
 * tombstones win ties); page-level fields (title, tags, paper, deleted) come from the newer page.
 */
export function mergePages(a: Page, b: Page): Page {
  const top = winner(a, b);
  return {
    ...top,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
    blocks: mergeItems(a.blocks ?? [], b.blocks ?? []),
    images: mergeItems(a.images ?? [], b.images ?? []),
  };
}

/** Newest notebook settings win; page order is the winner's, plus pages only the other knows. */
export function mergeNotebooks(a: Notebook, b: Notebook): Notebook {
  const top = winner(a, b);
  const other = top === a ? b : a;
  const order = [...top.pageOrder];
  for (const id of other.pageOrder) if (!order.includes(id)) order.push(id);
  return { ...top, pageOrder: order, updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt };
}

const PAGE_CONFLICT = /^(pg_[0-9A-Z]{26})(.+)\.json$/;
const NOTEBOOK_CONFLICT = /^notebook(.+)\.json$/;

/**
 * If `file` is a sync-tool conflict copy of a page or notebook file (e.g. `pg_X (conflicted copy).json`,
 * `pg_X.sync-conflict-2026….json`, `pg_X 2.json`), return the base file it belongs to.
 */
export function conflictBase(file: string): { kind: 'page' | 'notebook'; base: string } | null {
  const page = PAGE_CONFLICT.exec(file);
  if (page) return { kind: 'page', base: page[1] + '.json' };
  if (NOTEBOOK_CONFLICT.test(file)) return { kind: 'notebook', base: 'notebook.json' };
  return null;
}

/** True for the exact file names we write ourselves: `pg_<ulid>.json`. */
export const isPageFile = (file: string) => /^pg_[0-9A-Z]{26}\.json$/.test(file);

/** Union of the PDF registries; the earlier library's entry wins on a clash. */
export function mergeLibraries(a: Library, b: Library): Library {
  return {
    ...b,
    ...a,
    createdAt: a.createdAt < b.createdAt ? a.createdAt : b.createdAt,
    pdfs: { ...(b.pdfs ?? {}), ...(a.pdfs ?? {}) },
  };
}
