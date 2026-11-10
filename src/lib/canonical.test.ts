import { describe, expect, it } from 'vitest';
import { canonical, differs } from './canonical';

describe('canonical', () => {
  it('ignores key order at every depth', () => {
    expect(differs({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } }, { b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 })).toBe(false);
  });
  it('still sees real differences, including array order and values', () => {
    expect(differs({ a: [1, 2] }, { a: [2, 1] })).toBe(true);
    expect(differs({ a: 1 }, { a: 2 })).toBe(true);
    expect(differs({ a: 1 }, { a: 1, b: 2 })).toBe(true);
  });
  it('treats undefined properties as absent', () => {
    expect(differs({ a: 1, b: undefined }, { a: 1 })).toBe(false);
  });
  it('is stable', () => {
    expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
