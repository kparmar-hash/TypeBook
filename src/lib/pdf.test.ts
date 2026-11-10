import { describe, expect, it } from 'vitest';
import { buildPdf } from './pdf';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('buildPdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = buildPdf([{ jpeg, width: 800, height: 1000 }, { jpeg, width: 400, height: 300 }]);
  const text = latin1(pdf);

  it('has header, trailer and one page per image', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 600 750]');
    expect(text).toContain('/MediaBox [0 0 300 225]');
  });

  it('has an xref table whose offsets point at the objects', () => {
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const entries = text.slice(start).split('\n').filter((l) => /^\d{10} 00000 n/.test(l));
    expect(entries).toHaveLength(8);
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('embeds the JPEG bytes intact', () => {
    expect(text).toContain('/Length 9');
    expect(text).toContain(latin1(jpeg));
  });
});
