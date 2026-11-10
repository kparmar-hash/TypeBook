export interface PdfPage {
  /** JPEG file bytes */
  jpeg: Uint8Array;
  /** pixel size of the image */
  width: number;
  height: number;
}

const enc = new TextEncoder();

/** Minimal PDF: one full-bleed JPEG per page. `scale` converts image px to PDF points. */
export function buildPdf(pages: PdfPage[], scale = 0.75): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    length += b.length;
  };
  const obj = (n: number, body: (Uint8Array | string)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%âãÏÓ\n');
  const pageObj = (i: number) => 3 + i * 3;
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`]);
  pages.forEach((p, i) => {
    const n = pageObj(i);
    const w = +(p.width * scale).toFixed(2);
    const h = +(p.height * scale).toFixed(2);
    obj(n, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`,
    ]);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(n + 1, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    obj(n + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ]);
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
