import { describe, expect, it } from 'vitest';
import { baseName, findMatches, pageText, quoteFromPdf, sameText, sha256Hex } from './pdfText';

describe('pageText', () => {
  it('joins items and keeps line ends', () => {
    expect(pageText([{ str: 'Euclid', hasEOL: false }, { str: "'s algorithm", hasEOL: true }, { str: 'next' }])).toBe("Euclid's algorithm\nnext");
  });
});

describe('findMatches', () => {
  const pages = ['The greatest common divisor', 'gcd and GCD again; gcd', 'nothing here'];
  it('finds every occurrence, case-insensitively, with page and index', () => {
    expect(findMatches(pages, 'gcd')).toEqual([
      { page: 2, nth: 0 },
      { page: 2, nth: 1 },
      { page: 2, nth: 2 },
    ]);
  });
  it('ignores line breaks and runs of spaces inside the phrase', () => {
    expect(findMatches(['common\n  divisor'], 'common divisor')).toEqual([{ page: 1, nth: 0 }]);
  });
  it('returns nothing for an empty query', () => {
    expect(findMatches(pages, '   ')).toEqual([]);
  });
});

describe('quoteFromPdf', () => {
  it('joins wrapped lines and removes line-end hyphenation', () => {
    expect(quoteFromPdf('An algo-\nrithm is a finite\nset of rules')).toBe('An algorithm is a finite set of rules');
  });
  it('keeps real hyphens before capitals/digits and trims', () => {
    expect(quoteFromPdf('  step E1-\n2 done \n')).toBe('step E1- 2 done');
  });
});

describe('sameText', () => {
  it('compares ignoring whitespace', () => {
    expect(sameText('a b\nc', 'a  b c')).toBe(true);
    expect(sameText('a b', 'a c')).toBe(false);
  });
});

describe('misc', () => {
  it('baseName handles both separators', () => {
    expect(baseName('/home/u/TAOCP vol1.pdf')).toBe('TAOCP vol1.pdf');
    expect(baseName('C:\\Books\\x.pdf')).toBe('x.pdf');
  });
  it('hashes bytes', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
