export type Paper = 'blank' | 'ruled' | 'dots' | 'grid';
export type Ink = 'black' | 'blue' | 'red' | 'green' | 'pencil';
export type BlockStyle = 'normal' | 'heading' | 'definition' | 'theorem' | 'exercise' | 'note' | 'quote';
export type FontKey = 'caveat' | 'kalam' | 'patrick' | 'sans' | 'mono';

/** Points at a page of a PDF. `pdf` is a content hash, so it means the same file on every device. */
export interface PdfRef {
  pdf: string;
  page: number;
}

export interface Block {
  id: string;
  x: number;
  y: number;
  text: string;
  style: BlockStyle;
  ink: Ink;
  ref?: PdfRef;
  updatedAt: string;
  deleted: boolean;
}

export type ImageSize = 's' | 'm' | 'l';

export interface ImageItem {
  id: string;
  x: number;
  y: number;
  size: ImageSize;
  /** file name inside the notebook's assets/ folder */
  asset: string;
  updatedAt: string;
  deleted: boolean;
}

export interface Page {
  schema: 1;
  id: string;
  title: string;
  /** 'default' inherits the notebook's paper */
  paper: Paper | 'default';
  tags: string[];
  updatedAt: string;
  blocks: Block[];
  images: ImageItem[];
  deleted?: boolean;
}

export interface Notebook {
  schema: 1;
  id: string;
  name: string;
  paper: Paper;
  font: FontKey;
  fontSize: number;
  ink: Ink;
  margin: boolean;
  pageOrder: string[];
  updatedAt: string;
  deleted?: boolean;
}

export interface Library {
  schema: 1;
  createdAt: string;
  /** PDFs the notes refer to: hash -> display name. Paths are per device and never stored here. */
  pdfs?: Record<string, { name: string }>;
}

/** Storage boundary: the UI only talks to this, so another backend can replace the folder one. */
export type ExternalChange =
  | { type: 'page'; nbId: string; page: Page; conflict: boolean }
  | { type: 'notebook'; notebook: Notebook; conflict: boolean };

export interface PageStore {
  init(): Promise<void>;
  loadLibrary(): Promise<Library>;
  /** Merges with what is on disk so concurrent additions from other devices are kept. */
  saveLibrary(lib: Library): Promise<Library>;
  listNotebooks(): Promise<Notebook[]>;
  saveNotebook(nb: Notebook): Promise<void>;
  deleteNotebook(id: string): Promise<void>;
  listPages(notebookId: string): Promise<Page[]>;
  /** Returns the merged page if the file on disk held changes this page did not know about. */
  savePage(notebookId: string, page: Page): Promise<Page | null>;
  /** Merge any sync-conflict copies into their base files; returns how many were merged. */
  resolveConflicts(notebookId: string): Promise<number>;
  readAsset(notebookId: string, asset: string): Promise<string>;
  writeAsset(notebookId: string, asset: string, base64: string): Promise<void>;
  /** Report changes made outside this app (e.g. by a sync tool or another device). Returns a stop function. */
  watch?(onChange: (c: ExternalChange) => void): Promise<() => void>;
  /** Pull anything that changed while we were not listening (after being offline or in the background). */
  refresh?(): Promise<void>;
}
