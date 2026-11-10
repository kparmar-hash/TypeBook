import type { Block, ImageItem } from './types';

export interface Snapshot {
  title: string;
  paper: string;
  tags: string[];
  blocks: Block[];
  images: ImageItem[];
}

/** Snapshot-based undo/redo. Entries are whole-page states taken *before* a change. */
export class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  constructor(private limit = 200) {}

  /** Record the state before a change. */
  push(before: Snapshot) {
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: Snapshot): Snapshot | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current);
    return prev;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    return next;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
}

export const snapshotOf = (p: Snapshot): Snapshot =>
  JSON.parse(JSON.stringify({ title: p.title, paper: p.paper, tags: p.tags, blocks: p.blocks, images: p.images }));

export const sameSnapshot = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Turn the page's blocks into `target` while keeping sync semantics: changed blocks get a fresh
 * updatedAt, and blocks absent from the target become tombstones rather than disappearing.
 */
export function restoreBlocks<T extends { id: string; updatedAt: string; deleted: boolean }>(
  current: T[],
  target: T[],
  now: string,
): T[] {
  const targetById = new Map(target.map((b) => [b.id, b]));
  const currentById = new Map(current.map((b) => [b.id, b]));
  const out: T[] = [];
  for (const t of target) {
    const c = currentById.get(t.id);
    const same = c && JSON.stringify({ ...c, updatedAt: '' }) === JSON.stringify({ ...t, updatedAt: '' });
    out.push(same ? c : { ...t, updatedAt: now });
  }
  for (const c of current) {
    if (!targetById.has(c.id)) out.push(c.deleted ? c : { ...c, deleted: true, updatedAt: now });
  }
  return out;
}
