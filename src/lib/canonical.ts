/** JSON with object keys sorted, so two values with the same content compare equal whatever their key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** True when the two values differ in content (key order and `undefined` properties are ignored). */
export const differs = (a: unknown, b: unknown) => canonical(a) !== canonical(b);
