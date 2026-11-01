// Copies Tesseract worker, LSTM-only WASM cores and English language data
// into public/ocr so the app works fully offline (no CDN at runtime).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'ocr');
mkdirSync(out, { recursive: true });

const tessDir = dirname(require.resolve('tesseract.js/package.json'));
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const langDir = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

const files = [
  [join(tessDir, 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(coreDir, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(coreDir, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(coreDir, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [join(langDir, '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

for (const [src, name] of files) {
  if (!existsSync(src)) {
    console.error(`[copy-ocr-assets] missing: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(out, name));
}
console.log(`[copy-ocr-assets] copied ${files.length} files to public/ocr`);
