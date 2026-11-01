// On-device OCR via Tesseract.js. All assets are served from /ocr (copied at
// install time), so nothing leaves the phone and it works offline.

import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { adaptiveThreshold, filterComponents, maskToRgba, toGray } from './imageproc';
import type { OcrWord } from './layout';

const assetBase = () => new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;

let workerPromise: Promise<Worker> | null = null;
type ProgressFn = (status: string, progress: number) => void;
let progressListener: ProgressFn | null = null;

export function onOcrProgress(fn: ProgressFn | null) {
  progressListener = fn;
}

export function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const base = assetBase();
    workerPromise = (async () => {
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base,
        gzip: true,
        logger: (m) => progressListener?.(m.status, m.progress),
      });
      await worker.setParameters({
        // Scene text: scattered words anywhere in the frame (plates, labels).
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

export type Variant = 'plain' | 'light-text' | 'dark-text';

/**
 * plain:      grayscale + contrast stretch (clean labels, screens, recipes)
 * light-text: inverted, locally binarized, big shapes removed (white/embossed text on black plates)
 * dark-text:  same but not inverted (dark text on colored bumper plates, busy backgrounds)
 */
export function preprocess(src: HTMLCanvasElement, variant: Variant): HTMLCanvasElement {
  const { width: w, height: h } = src;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const gray = toGray(img.data, variant === 'light-text');
  if (variant === 'plain') {
    for (let i = 0; i < gray.length; i++) img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = gray[i];
  } else {
    const mask = filterComponents(adaptiveThreshold(gray, w, h), w, h);
    maskToRgba(mask, img.data);
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export async function recognizeWords(canvas: HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words) {
          if (word.confidence < 30) continue;
          // Plate rims and shadows often come back as a lone low-confidence letter.
          if (word.text.length === 1 && !/\d/.test(word.text) && word.confidence < 70) continue;
          words.push({ text: word.text, bbox: word.bbox, confidence: word.confidence });
        }
      }
    }
  }
  return words;
}
