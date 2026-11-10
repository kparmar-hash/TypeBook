// pdf.js loads CMaps, standard fonts and wasm decoders at runtime. Serve them from the app itself (offline).
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const src = 'node_modules/pdfjs-dist';
const dest = 'public/pdfjs';
if (!existsSync(src)) process.exit(0);
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  if (existsSync(`${dest}/${dir}`)) continue;
  mkdirSync(dest, { recursive: true });
  cpSync(`${src}/${dir}`, `${dest}/${dir}`, { recursive: true });
}
