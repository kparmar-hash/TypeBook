import { describe, expect, it } from 'vitest';
import { codeEnter, codeOutdent, insideCode, rawOffsetInLine, renderBlock, renderInline, segment } from './markup';

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

describe('code blocks', () => {
  const fence = (lang: string, code: string) => '```' + lang + '\n' + code + '\n```';

  it('renders a fenced block as preformatted monospace code with its language', () => {
    const html = renderBlock(fence('python', 'def f(x):\n    return x'));
    expect(html).toContain('class="ln cb"');
    expect(html).toContain('<span class="cb-lang">python</span>');
    expect(html).toContain('<pre><code>def f(x):\n    return x</code></pre>');
  });
  it('keeps indentation and escapes html', () => {
    expect(renderBlock(fence('', 'if (a < b && c > d) {\n\tx = "y";\n}'))).toContain('if (a &lt; b &amp;&amp; c &gt; d) {\n\tx = &quot;y&quot;;\n}');
  });
  it('shows no language label when none is given', () => {
    expect(renderBlock(fence('', 'x'))).not.toContain('cb-lang');
  });
  it('does not format inside code: math, bold, backticks and lists are literal', () => {
    const html = renderBlock(fence('c', 'a $$ b $$ **c** `d`\n- e'));
    expect(html).not.toContain('katex');
    expect(html).not.toContain('<strong>');
    expect(html).toContain('a $$ b $$ **c** `d`\n- e');
  });
  it('does not turn a fence inside display math into code', () => {
    const html = renderBlock('$$ x ``` y $$');
    expect(html).toContain('katex');
    expect(html).not.toContain('class="ln cb"');
  });
  it('sits between ordinary lines and math without losing them', () => {
    const html = renderBlock('before\n' + fence('js', 'x()') + '\nafter $y$');
    expect(html.match(/class="ln/g)).toHaveLength(3);
    expect(html.indexOf('before')).toBeLessThan(html.indexOf('<pre>'));
    expect(html.indexOf('<pre>')).toBeLessThan(html.indexOf('after'));
    expect(html).toContain('katex'); // the inline math after the block still renders
  });
  it('leaves an unclosed fence as plain text while you are still typing it', () => {
    const html = renderBlock('```js\nlet a = 1');
    expect(html).not.toContain('<pre>');
    expect(html).toContain('let a = 1');
  });
  it('handles two blocks and an empty one', () => {
    expect(renderBlock(fence('a', 'one') + '\n' + fence('b', 'two')).match(/<pre>/g)).toHaveLength(2);
    expect(renderBlock('```\n```')).toContain('<pre><code></code></pre>');
  });
  it('records where the code starts so a click can be mapped to the right character', () => {
    const text = 'hi\n' + fence('js', 'abc');
    const seg = segment(text).find((s) => s.kind === 'code');
    expect(seg).toMatchObject({ lang: 'js', code: 'abc' });
    expect(text.slice((seg as { codeStart: number }).codeStart, (seg as { codeStart: number }).codeStart + 3)).toBe('abc');
  });
  it('takes only the first word of the info string as the language', () => {
    expect(segment('```ts title="x"\ncode\n```').find((s) => s.kind === 'code')).toMatchObject({ lang: 'ts' });
  });
});

describe('typing inside code blocks', () => {
  const text = 'intro\n```js\nif (x) {\n  y();\n```';
  const at = (needle: string, extra = 0) => text.indexOf(needle) + extra;

  it('knows when the caret is inside the code', () => {
    expect(insideCode(text, at('y();', 2))).toBe(true);
    expect(insideCode(text, at('intro', 2))).toBe(false);
    expect(insideCode(text, at('```js', 2))).toBe(false); // on the fence line itself
    expect(insideCode('no fence here', 3)).toBe(false);
  });
  it('Enter keeps the indentation of the current line', () => {
    expect(codeEnter(text, at('y();', 4))).toBe('\n  ');
    expect(codeEnter(text, at('if (x)', 3))).toBe('\n');
    expect(codeEnter(text, at('intro', 5))).toBeNull(); // outside code Enter behaves normally
  });
  it('Shift+Tab removes one indent from the line, and only inside code', () => {
    const cut = codeOutdent(text, at('y();', 3))!;
    expect(text.slice(cut.from, cut.to)).toBe('  ');
    expect(codeOutdent(text, at('if (x)', 2))).toBeNull(); // nothing to remove
    expect(codeOutdent(text, at('intro', 2))).toBeNull();
  });
});
