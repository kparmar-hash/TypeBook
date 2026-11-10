import type { FontKey, Ink, Paper } from './types';

export const FONTS: Record<FontKey, { label: string; css: string }> = {
  caveat: { label: 'Caveat', css: "'Caveat', cursive" },
  kalam: { label: 'Kalam', css: "'Kalam', cursive" },
  patrick: { label: 'Patrick Hand', css: "'Patrick Hand', cursive" },
  sans: { label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  mono: { label: 'JetBrains Mono', css: "'JetBrains Mono', ui-monospace, monospace" },
};

export const INKS: { key: Ink; label: string }[] = [
  { key: 'black', label: 'Black' },
  { key: 'blue', label: 'Blue' },
  { key: 'red', label: 'Red' },
  { key: 'green', label: 'Green' },
  { key: 'pencil', label: 'Pencil' },
];

export const PAPERS: { key: Paper; label: string }[] = [
  { key: 'blank', label: 'Blank' },
  { key: 'ruled', label: 'Ruled' },
  { key: 'dots', label: 'Dot grid' },
  { key: 'grid', label: 'Square grid' },
];
