import { describe, expect, it } from 'vitest';
import { rawOffsetInLine, renderBlock, renderInline, segment } from './markup';

describe('renderInline', () => {
  it('formats bold, italic, highlight and code', () => {
    expect(renderInline('**a** *b* ==c== `d`')).toBe(
      '<strong>a</strong> <em>b</em> <mark>c</mark> <code>d</code>',
    );
  });
  it('escapes html', () => {
    expect(renderInline('<b>&')).toBe('&lt;b&gt;&amp;');
  });
  it('does not format inside code or math', () => {
    expect(renderInline('`**x**`')).toBe('<code>**x**</code>');
    expect(renderInline('$a*b*c$')).toContain('katex');
    expect(renderInline('$a*b*c$')).not.toContain('<em>');
  });
  it('renders inline math with KaTeX', () => {
    expect(renderInline('gcd $m+n$')).toContain('class="katex"');
  });
});

describe('renderBlock', () => {
  it('renders bullets and numbers', () => {
    const html = renderBlock('- one\n1. two');
    expect(html).toContain('•');
    expect(html).toContain('<span class="mk">1.</span>');
  });
  it('renders display math as its own block', () => {
    const html = renderBlock('before\n$$x^2$$\nafter');
    expect(html).toContain('katex-display');
    expect(html.match(/class="ln/g)?.length).toBe(3);
  });
  it('keeps empty lines', () => {
    expect(renderBlock('a\n\nb').match(/class="ln/g)?.length).toBe(3);
  });
});

describe('segment', () => {
  it('tracks raw offsets', () => {
    const segs = segment('ab\ncd');
    expect(segs.map((s) => s.start)).toEqual([0, 3]);
  });
});

describe('rawOffsetInLine', () => {
  it('skips markup and list prefixes', () => {
    expect(rawOffsetInLine('**ab**c', 2)).toBe(6);
    expect(rawOffsetInLine('- hello', 0)).toBe(2);
    expect(rawOffsetInLine('- hello', 3)).toBe(5);
  });
  it('treats math as zero width', () => {
    expect(rawOffsetInLine('$x+y$ ab', 1)).toBe(6);
  });
});
