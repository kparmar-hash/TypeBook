export interface TextItem {
  str: string;
  hasEOL?: boolean;
}

/** Plain text of one PDF page, keeping line ends. */
export const pageText = (items: TextItem[]) => items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join('');

const flat = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

export interface Match {
  /** 1-based page number */
  page: number;
  /** which occurrence on that page, from 0 */
  nth: number;
}

/** Every occurrence of `query` (case-insensitive, whitespace-insensitive) across the pages' text, in page order. */
export function findMatches(texts: string[], query: string): Match[] {
  const q = flat(query).trim();
  if (!q) return [];
  const out: Match[] = [];
  texts.forEach((text, i) => {
    const t = flat(text);
    let from = 0;
    for (let nth = 0; ; nth++) {
      const at = t.indexOf(q, from);
      if (at < 0) break;
      out.push({ page: i + 1, nth });
      from = at + q.length;
    }
  });
  return out;
}

/** Turn text copied out of a PDF (hard-wrapped, hyphenated at line ends) into one clean paragraph. */
export function quoteFromPdf(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Same words regardless of how whitespace was handled on the way through the clipboard. */
export const sameText = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
