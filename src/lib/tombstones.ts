import type { Block, Notebook, Page } from './types';

/**
 * What the server keeps of a deleted thing (see supabase/migrations/20261110000000_scrub_deleted.sql):
 * enough to stop a stale device from bringing it back, but none of the content. Keep this in step with the SQL.
 */
export const DELETED_NOTEBOOK_NAME = 'Deleted notebook';

export function scrubBlock(b: Block): Block {
  if (!b.deleted) return b;
  const { ref: _ref, ...rest } = b;
  return { ...rest, text: '' };
}

export function scrubPage(p: Page): Page {
  if (p.deleted) return { ...p, title: '', tags: [], blocks: [], images: [] };
  return { ...p, blocks: p.blocks.map(scrubBlock) };
}

export function scrubNotebook(n: Notebook): Notebook {
  return n.deleted ? { ...n, name: DELETED_NOTEBOOK_NAME, pageOrder: [] } : n;
}
