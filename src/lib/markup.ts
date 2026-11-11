import katex from 'katex';

const PH_OPEN = '';
const PH_CLOSE = '';

const mathCache = new Map<string, string>();

function renderMath(tex: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + tex;
  let html = mathCache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' });
    if (mathCache.size > 2000) mathCache.clear();
    mathCache.set(key, html);
  }
  return html;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline formatting for one line of text (no display math). */
export function renderInline(line: string): string {
  const stash: string[] = [];
  const hold = (html: string) => {
    stash.push(html);
    return PH_OPEN + (stash.length - 1) + PH_CLOSE;
  };
  let s = line.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, tex) => hold(renderMath(tex, false)));
  s = escapeHtml(s);
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/==([^=\n]+?)==/g, '<mark>$1</mark>');
  return s.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_, i) => stash[+i]);
}

export type Segment =
  | { kind: 'line'; raw: string; start: number }
  | { kind: 'display'; raw: string; start: number; tex: string }
  | { kind: 'code'; raw: string; start: number; lang: string; code: string; codeStart: number };

/**
 * A fenced code block (```lang on its own line, closed by ```) or display math ($$ ... $$). One pass finds whichever
 * comes first, so `$$` inside code is just code and a fence inside math is just math. An unclosed fence stays plain
 * text until you close it.
 */
const BLOCK_RE = /```([^\n`]*)\n([\s\S]*?)\n?```|\$\$([\s\S]+?)\$\$/g;

/** Split text into lines, display math and code blocks, remembering raw offsets for caret mapping. */
export function segment(text: string): Segment[] {
  const out: Segment[] = [];
  const pushText = (chunk: string, base: number) => {
    const lines = chunk.split('\n');
    let off = base;
    for (const l of lines) {
      out.push({ kind: 'line', raw: l, start: off });
      off += l.length + 1;
    }
  };
  const re = new RegExp(BLOCK_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let before = text.slice(last, m.index);
    let base = last;
    if (before.endsWith('\n')) before = before.slice(0, -1);
    if (before.length || m.index === last) {
      if (before.length) pushText(before, base);
    }
    if (m[3] !== undefined) out.push({ kind: 'display', raw: m[0], start: m.index, tex: m[3].trim() });
    else
      out.push({
        kind: 'code',
        raw: m[0],
        start: m.index,
        lang: m[1].trim().split(/\s+/)[0] ?? '',
        code: m[2],
        codeStart: m.index + 3 + m[1].length + 1,
      });
    last = m.index + m[0].length;
    if (text[last] === '\n') last++;
  }
  if (last < text.length || out.length === 0 || text.endsWith('\n')) pushText(text.slice(last), last);
  return out;
}

const LIST_RE = /^(- |\d+\. )/;

export function renderBlock(text: string): string {
  return segment(text)
    .map((seg) => {
      if (seg.kind === 'display') {
        return `<div class="ln dm" data-s="${seg.start}" data-e="${seg.start + seg.raw.length}">${renderMath(seg.tex, true)}</div>`;
      }
      if (seg.kind === 'code') {
        const lang = seg.lang ? `<span class="cb-lang">${escapeHtml(seg.lang)}</span>` : '';
        return `<div class="ln cb" data-s="${seg.start}" data-e="${seg.start + seg.raw.length}" data-cs="${seg.codeStart}">${lang}<pre><code>${escapeHtml(seg.code)}</code></pre></div>`;
      }
      const attrs = `data-s="${seg.start}" data-e="${seg.start + seg.raw.length}"`;
      const li = LIST_RE.exec(seg.raw);
      if (li) {
        const marker = li[1] === '- ' ? '•' : li[1].trim();
        return `<div class="ln li" ${attrs}><span class="mk">${marker}</span><span>${renderInline(seg.raw.slice(li[1].length))}</span></div>`;
      }
      return `<div class="ln" ${attrs}>${seg.raw ? renderInline(seg.raw) : '<br>'}</div>`;
    })
    .join('');
}

/**
 * Map "k visible characters into this line" back to an offset in the raw line,
 * skipping list prefixes, markup characters and math (math counts as 0 visible chars).
 */
export function rawOffsetInLine(raw: string, visible: number): number {
  let i = LIST_RE.exec(raw)?.[1].length ?? 0;
  let seen = 0;
  while (i < raw.length) {
    if (raw[i] === '$') {
      const close = raw.indexOf('$', i + 1);
      if (close > 0) {
        i = close + 1;
        continue;
      }
    }
    if (raw.startsWith('**', i) || raw.startsWith('==', i)) {
      i += 2;
      continue;
    }
    if (raw[i] === '*' || raw[i] === '`') {
      i++;
      continue;
    }
    if (seen >= visible) break;
    seen++;
    i++;
  }
  return i;
}

/** The code block containing `pos` (a caret offset into `text`), if any. */
function codeAt(text: string, pos: number) {
  for (const seg of segment(text)) {
    if (seg.kind === 'code' && pos >= seg.codeStart && pos <= seg.codeStart + seg.code.length) return seg;
  }
  return null;
}

export const insideCode = (text: string, pos: number) => codeAt(text, pos) !== null;

/** Pressing Enter inside a code block: a new line that keeps the current line's indentation. Null outside code. */
export function codeEnter(text: string, pos: number): string | null {
  if (!codeAt(text, pos)) return null;
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  return '\n' + /^[ \t]*/.exec(text.slice(lineStart, pos))![0];
}

export const CODE_INDENT = '  ';

/** Shift+Tab inside a code block: the range of leading spaces (up to one indent) to remove from the caret's line. */
export function codeOutdent(text: string, pos: number): { from: number; to: number } | null {
  if (!codeAt(text, pos)) return null;
  const from = text.lastIndexOf('\n', pos - 1) + 1;
  const lead = /^[ \t]*/.exec(text.slice(from))![0];
  const n = lead.startsWith('\t') ? 1 : Math.min(lead.length, CODE_INDENT.length);
  return n ? { from, to: from + n } : null;
}
