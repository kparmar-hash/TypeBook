import type { Page } from './types';

export interface IndexEntry {
  nbId: string;
  nbName: string;
  pageId: string;
  title: string;
  tags: string[];
  /** all live block text, including TeX source */
  text: string;
  updatedAt: string;
}

export interface Hit {
  entry: IndexEntry;
  score: number;
  snippet: string;
}

export function entryOf(nbId: string, nbName: string, page: Page): IndexEntry {
  return {
    nbId,
    nbName,
    pageId: page.id,
    title: page.title,
    tags: page.tags,
    text: page.blocks
      .filter((b) => !b.deleted)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((b) => b.text)
      .join('\n'),
    updatedAt: page.updatedAt,
  };
}

const norm = (s: string) => s.toLowerCase();

/** Pull a ~80 char window around the first match so results show context. */
function snippetFor(text: string, term: string): string {
  const flat = text.replace(/\s+/g, ' ');
  const i = norm(flat).indexOf(term);
  if (i < 0) return flat.slice(0, 80);
  const start = Math.max(0, i - 25);
  return (start > 0 ? '…' : '') + flat.slice(start, start + 80) + (start + 80 < flat.length ? '…' : '');
}

/**
 * Space-separated terms must all match (title, tags or text, case-insensitive; TeX source is searchable).
 * `#tag` terms must match a tag exactly-prefix. Title hits rank above tag hits above body hits.
 */
export function search(index: Iterable<IndexEntry>, query: string, limit = 30): Hit[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const entry of index) {
    const title = norm(entry.title);
    const tags = entry.tags.map(norm);
    const text = norm(entry.text);
    let score = 0;
    let snippetTerm = '';
    let ok = true;
    for (const t of terms) {
      if (t.startsWith('#')) {
        const tag = t.slice(1);
        if (!tag || !tags.some((x) => x.startsWith(tag))) {
          ok = false;
          break;
        }
        score += 6;
      } else if (title.includes(t)) score += 10;
      else if (tags.some((x) => x.includes(t))) score += 6;
      else if (text.includes(t)) {
        score += 2;
        snippetTerm ||= t;
      } else {
        ok = false;
        break;
      }
    }
    if (ok) hits.push({ entry, score, snippet: snippetTerm ? snippetFor(entry.text, snippetTerm) : entry.text.replace(/\s+/g, ' ').slice(0, 80) });
  }
  return hits
    .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
    .slice(0, limit);
}
