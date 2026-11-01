/// <reference lib="webworker" />
// On-device OCR with PaddleOCR (PP-OCRv4) running in ONNX Runtime WASM, inside a
// worker so the UI never freezes. All model/runtime files are self-hosted under
// /ocr so nothing leaves the phone and it works offline once cached.
//
// Why not just recognize the whole photo: gym text is printed on round,
// tilted dumbbell heads and plates, often upside down. Recognition models only
// read roughly horizontal text. So we (1) detect where text is, then
// (2) read each small region at several rotations and keep the best reading.

import * as ort from 'onnxruntime-web';
import { PaddleOcrService } from 'ppu-paddle-ocr/web';
import { findQuantities } from './units';
import { type OcrWord } from './layout';
import { interpret } from './reading';

export type WorkerRequest = { type: 'init'; base: string; debug?: boolean } | { type: 'read'; id: number; image: ImageBitmap };
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'words'; id: number; words: OcrWord[]; final: boolean }
  | { type: 'error'; id?: number; message: string };

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

// Try upright first; stop early once a confident number is found.
const ANGLES = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
const GOOD_ENOUGH = 0.9;
const MIN_CONFIDENCE = 0.7;
const CROP_MAX_SIDE = 1024; // downscaling crops further was faster but lost real readings

let service: PaddleOcrService | null = null;
let DEBUG = false;
let ready: Promise<void> | null = null;

function init(base: string) {
  if (ready) return ready;
  ort.env.wasm.wasmPaths = `${base}ort/`;
  ort.env.wasm.numThreads = 1;
  service = new PaddleOcrService({
    model: {
      detection: `${base}det.onnx`,
      recognition: `${base}rec.onnx`,
      charactersDictionary: `${base}dict.txt`,
    },
    session: { executionProviders: ['wasm'] },
  });
  ready = service.initialize();
  return ready;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlap(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (ix * iy) / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

/** Merge boxes that mostly overlap (the detector sometimes splits one label). */
function mergeBoxes(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of [...boxes].sort((p, q) => q.width * q.height - p.width * p.height)) {
    const hit = out.find((o) => overlap(o, b) > 0.4);
    if (!hit) out.push({ ...b });
    else {
      const x1 = Math.max(hit.x + hit.width, b.x + b.width);
      const y1 = Math.max(hit.y + hit.height, b.y + b.height);
      hit.x = Math.min(hit.x, b.x);
      hit.y = Math.min(hit.y, b.y);
      hit.width = x1 - hit.x;
      hit.height = y1 - hit.y;
    }
  }
  return out;
}

function cropRotated(src: OffscreenCanvas, box: Box, angleDeg: number): OffscreenCanvas {
  // Margin from the short side: enough room to rotate a tilted label, without pulling in the next line of text.
  const m = Math.round(Math.min(box.width, box.height) * 0.3);
  const x = Math.max(0, box.x - m);
  const y = Math.max(0, box.y - m);
  const w = Math.min(src.width - x, box.width + m * 2);
  const h = Math.min(src.height - y, box.height + m * 2);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  // Small crops are plenty for the recognizer (48px tall input) and much faster to run.
  const k = Math.min(1, CROP_MAX_SIDE / Math.max(w, h));
  const sw = w * k;
  const sh = h * k;
  const pad = 20; // breathing room around the text; less made the detector miss tilted labels
  const out = new OffscreenCanvas(Math.ceil(sw * cos + sh * sin) + pad * 2, Math.ceil(sw * sin + sh * cos) + pad * 2);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, x, y, w, h, -sw / 2, -sh / 2, sw, sh);
  return out;
}

interface Reading {
  text: string;
  confidence: number;
  angle: number;
  score: number;
}

/** Latin words only, none of which is a unit ("ao LB" is a misread "40 LB", not prose). */
function isPlainWords(raw: string): boolean {
  if (!/^[A-Za-z][A-Za-z .,'-]*$/.test(raw)) return false;
  return !raw.split(/\s+/).some((word) => findQuantities(`1 ${word}`).length > 0);
}

async function readAt(src: OffscreenCanvas, box: Box, angle: number): Promise<Reading> {
  const res = await service!.recognize(cropRotated(src, box, angle), { flatten: true });
  const raw = res.text.replace(/\s+/g, ' ').trim();
  const { text, score } = interpret(raw, res.confidence);
  if (DEBUG) console.log('[uniffy] region', JSON.stringify(box), angle, JSON.stringify(raw), res.confidence.toFixed(2), score.toFixed(2));
  return { text, confidence: res.confidence, angle, score, raw } as Reading & { raw: string };
}

async function readRegion(src: OffscreenCanvas, box: Box): Promise<Reading | null> {
  let best: Reading | null = null;
  // Coarse pass: every 30°, stop early on a confident reading.
  for (const angle of ANGLES) {
    const reading = (await readAt(src, box, angle)) as Reading & { raw: string };
    // Upright, confident, plain Latin words with no digits ("Bake", "flour"): not worth rotating.
    if (angle === 0 && reading.confidence >= 0.8 && isPlainWords(reading.raw)) return null;
    if (!best || reading.score > best.score) best = reading;
    if (best.score >= GOOD_ENOUGH) return best;
  }
  // Fine pass: the real tilt is usually between two coarse steps.
  if (best && best.score > 0) {
    const center = best.angle;
    for (const angle of [center - 15, center + 15]) {
      const reading = await readAt(src, box, angle);
      if (reading.score > best.score) best = reading;
      if (best.score >= GOOD_ENOUGH) break;
    }
  }
  return best && best.score >= MIN_CONFIDENCE ? best : null;
}

/** Split an upright reading into words with proportional boxes, so the overlay lands on "350°F", not the whole line. */
function toWords(reading: Reading, box: Box): OcrWord[] {
  const conf = reading.confidence * 100;
  const whole = { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height };
  if (reading.angle !== 0) return [{ text: reading.text, bbox: whole, confidence: conf }];
  const words: OcrWord[] = [];
  const len = reading.text.length;
  for (const m of reading.text.matchAll(/\S+/g)) {
    const x0 = box.x + (box.width * m.index!) / len;
    const x1 = box.x + (box.width * (m.index! + m[0].length)) / len;
    words.push({ text: m[0], bbox: { x0, y0: box.y, x1, y1: box.y + box.height }, confidence: conf });
  }
  return words;
}

async function read(id: number, bitmap: ImageBitmap) {
  await ready;
  const src = new OffscreenCanvas(bitmap.width, bitmap.height);
  src.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { boxes } = await service!.detect(src);
  const regions = mergeBoxes(boxes).filter((b) => b.width >= 8 && b.height >= 8);
  if (DEBUG) console.log('[uniffy] boxes', src.width, src.height, JSON.stringify(boxes));
  const words: OcrWord[] = [];
  for (let i = 0; i < regions.length; i++) {
    post({ type: 'progress', id, done: i, total: regions.length });
    const reading = await readRegion(src, regions[i]);
    if (reading) {
      words.push(...toWords(reading, regions[i]));
      post({ type: 'words', id, words: [...words], final: false });
    }
  }
  post({ type: 'words', id, words, final: true });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      DEBUG = !!msg.debug;
      await init(msg.base);
      post({ type: 'ready' });
    } else if (msg.type === 'read') {
      await read(msg.id, msg.image);
    }
  } catch (err) {
    post({ type: 'error', id: msg.type === 'read' ? msg.id : undefined, message: String((err as Error)?.message ?? err) });
  }
};
