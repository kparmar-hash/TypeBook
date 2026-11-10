import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const dirname = (p: string) => p.replace(/[\\/][^\\/]*$/, '');

/** Write a file at an absolute path (desktop only). */
export async function writeFileAt(path: string, data: string | Uint8Array) {
  if (typeof data === 'string') await invoke('write_atomic', { path, contents: data });
  else await invoke('write_base64', { path, data: toBase64(data) });
}

function download(name: string, data: string | Uint8Array, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Ask where to save and write the file. Returns the chosen path (or the name in a browser), null if cancelled. */
export async function saveAs(
  defaultName: string,
  data: string | Uint8Array,
  filterName: string,
  ext: string,
  mime: string,
): Promise<string | null> {
  if (!inTauri) {
    download(defaultName, data, mime);
    return defaultName;
  }
  const path = await save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
  if (!path) return null;
  await writeFileAt(path, data);
  return path;
}

export async function chooseFolder(title: string): Promise<string | null> {
  if (!inTauri) throw new Error('Folder export needs the desktop app');
  const dir = await open({ directory: true, multiple: false, title });
  return typeof dir === 'string' ? dir : null;
}
