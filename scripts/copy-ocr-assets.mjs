// Copies the PaddleOCR models and the ONNX Runtime WASM runtime into public/ocr
// (self-hosted: otherwise the runtime is fetched from a CDN, which breaks offline use)
// so the app works fully offline (no CDN or model hub at runtime).
import { copyFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const out = join(process.cwd(), 'public', 'ocr');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'ort'), { recursive: true });

const models = join(process.cwd(), 'node_modules', '@gutenye', 'ocr-models', 'assets');
const ort = join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist');

const files = [
  [join(models, 'ch_PP-OCRv4_det_infer.onnx'), 'det.onnx'],
  [join(models, 'ch_PP-OCRv4_rec_infer.onnx'), 'rec.onnx'],
  [join(models, 'ppocr_keys_v1.txt'), 'dict.txt'],
  [join(ort, 'ort-wasm-simd-threaded.wasm'), 'ort/ort-wasm-simd-threaded.wasm'],
  [join(ort, 'ort-wasm-simd-threaded.mjs'), 'ort/ort-wasm-simd-threaded.mjs'],
];

for (const [src, name] of files) {
  if (!existsSync(src)) {
    console.error(`[copy-ocr-assets] missing: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(out, name));
}
console.log(`[copy-ocr-assets] copied ${files.length} files to public/ocr`);
