// Main-thread wrapper around the OCR worker.
import type { OcrWord } from './layout';
import type { WorkerRequest, WorkerResponse } from './ocr.worker';

const base = () => new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 1;
const jobs = new Map<
  number,
  { onWords: (w: OcrWord[]) => void; onProgress: (done: number, total: number) => void; resolve: (w: OcrWord[]) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'ready') return;
    const job = msg.id !== undefined ? jobs.get(msg.id) : undefined;
    if (msg.type === 'error') {
      if (job) {
        jobs.delete(msg.id!);
        job.reject(new Error(msg.message));
      } else console.error('[ocr]', msg.message);
      return;
    }
    if (!job) return;
    if (msg.type === 'progress') job.onProgress(msg.done, msg.total);
    else if (msg.type === 'words') {
      job.onWords(msg.words);
      if (msg.final) {
        jobs.delete(msg.id);
        job.resolve(msg.words);
      }
    }
  };
  return worker;
}

/** Loads the models (first time ~30MB, then cached). Safe to call repeatedly. */
export function warmUp(): Promise<void> {
  if (!readyPromise) {
    const w = getWorker();
    readyPromise = new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'ready') {
          w.removeEventListener('message', onMsg);
          resolve();
        } else if (e.data.type === 'error' && e.data.id === undefined) {
          w.removeEventListener('message', onMsg);
          readyPromise = null;
          reject(new Error(e.data.message));
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'init', base: base(), debug: location.hash === '#debug' } satisfies WorkerRequest);
    });
  }
  return readyPromise;
}

export async function readImage(
  canvas: HTMLCanvasElement,
  onWords: (w: OcrWord[]) => void,
  onProgress: (done: number, total: number) => void,
): Promise<OcrWord[]> {
  await warmUp();
  const bitmap = await createImageBitmap(canvas);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { onWords, onProgress, resolve, reject });
    getWorker().postMessage({ type: 'read', id, image: bitmap } satisfies WorkerRequest, [bitmap]);
  });
}
