/** Reactive state of the PDF side pane. No imports, so both the app state and the pdf.js wrapper can use it. */

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export const pdf = $state({
  /** pane visible */
  open: false,
  /** content hash of the loaded PDF ('' when none) */
  hash: '',
  name: '',
  page: 1,
  numPages: 0,
  /** 0 = fit width */
  zoom: 0,
  /** effective scale of the rendered page */
  scale: 1,
  width: Number(ls.get('tb-pdf-width')) || 520,
  autoLink: ls.get('tb-pdf-autolink') === '1',
  loading: false,
  error: '',
  query: '',
  matchCount: 0,
  matchIdx: -1,
  searching: false,
});

export const pdfRef = () => (pdf.open && pdf.hash ? { pdf: pdf.hash, page: pdf.page } : undefined);

export function setPdfWidth(w: number) {
  pdf.width = w;
  ls.set('tb-pdf-width', String(Math.round(w)));
}
export function setAutoLink(on: boolean) {
  pdf.autoLink = on;
  ls.set('tb-pdf-autolink', on ? '1' : '0');
}
