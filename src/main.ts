import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { detect, LB_PLATES, type Detection, type OcrWord } from './layout';
import { readImage, warmUp } from './ocr';
import { applyStatic, getLocale, setLocale, t, type Locale } from './i18n';
import { convertText, convertValue, formatQuantity, UNITS } from './units';

// Always convert to metric: the app is for people who think in kg / °C / cm.
const TARGET = 'metric' as const;
const BAR_KG = 20;
const MAX_DIM = 1600;

// ---------- elements ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const video = $<HTMLVideoElement>('video');
const shot = $<HTMLCanvasElement>('shot');
const guide = $('guide');
const hint = $('hint');
const statusEl = $('status');
const cameraMsg = $('camera-msg');
const sheet = $('sheet');
const resultsEl = $('results');
const summaryEl = $('summary');
const emptyEl = $('empty');
const shutter = $<HTMLButtonElement>('shutter');
const shutterLabel = $('shutter-label');
const fileInput = $<HTMLInputElement>('file');
const manualInput = $<HTMLInputElement>('manual-input');
const manualOut = $('manual-out');

// ---------- state ----------
type Mode = 'camera' | 'photo';
let mode: Mode = 'camera';
let photo: HTMLCanvasElement | null = null;
let words: OcrWord[] = [];
let detections: Detection[] = [];
const removed = new Set<number>();
let busy = false;
let runId = 0;
let modelsReady = false;

// ---------- status ----------
// Status and camera messages are stored as keys so they re-render when the language changes.
type StatusKey = Parameters<typeof t>[0];
let status: { key: StatusKey; params?: Record<string, number> } | null = null;
function setStatus(key: StatusKey | null, params?: Record<string, number>) {
  status = key ? { key, params } : null;
  renderStatus();
}
function renderStatus() {
  statusEl.hidden = !status;
  statusEl.textContent = status ? t(status.key, status.params) : '';
}

// ---------- camera ----------
let stream: MediaStream | null = null;
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraMsg('camera.unsupported');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    cameraMsgKey = null;
    cameraMsg.hidden = true;
  } catch (err) {
    const name = (err as DOMException)?.name;
    showCameraMsg(
      name === 'NotAllowedError' ? 'camera.denied' : 'camera.failed',
    );
  }
}
let cameraMsgKey: StatusKey | null = null;
function showCameraMsg(key: StatusKey) {
  cameraMsgKey = key;
  cameraMsg.textContent = t(key);
  cameraMsg.hidden = mode !== 'camera';
}

function scaledCanvas(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DIM / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/** Crop the video frame to the on-screen guide box (video is shown with object-fit: cover). */
function captureGuide(): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const s = stage.getBoundingClientRect();
  const g = guide.getBoundingClientRect();
  const scale = Math.max(s.width / vw, s.height / vh);
  const offX = (s.width - vw * scale) / 2;
  const offY = (s.height - vh * scale) / 2;
  const x = Math.max(0, (g.left - s.left - offX) / scale);
  const y = Math.max(0, (g.top - s.top - offY) / scale);
  const w = Math.min(vw - x, g.width / scale);
  const h = Math.min(vh - y, g.height / scale);
  return scaledCanvas(video, x, y, w, h);
}

// ---------- capture + OCR ----------
async function analyze(canvas: HTMLCanvasElement) {
  const id = ++runId;
  photo = canvas;
  words = [];
  detections = [];
  removed.clear();
  setMode('photo');
  render();

  busy = true;
  render();
  try {
    setStatus(modelsReady ? 'status.reading' : 'status.firstLoad');
    const update = (found: OcrWord[]) => {
      if (id !== runId) return;
      words = found;
      detections = detect(words, TARGET, { guessWeights: true });
      render();
    };
    const final = await readImage(canvas, update, (done, total) => {
      modelsReady = true;
      if (id === runId) setStatus('status.readingN', { done: done + 1, total });
    });
    if (id !== runId) return;
    update(final);
    if (location.hash === '#debug') console.log('[uniffy] words', JSON.stringify(words));
    setStatus(null);
  } catch (err) {
    console.error(err);
    if (id === runId) setStatus('status.failed');
  } finally {
    if (id === runId) {
      busy = false;
      render();
    }
  }
}

// ---------- modes ----------
function setMode(next: Mode) {
  mode = next;
  const cam = next === 'camera';
  video.hidden = !cam;
  guide.hidden = !cam;
  hint.hidden = !cam;
  shot.hidden = cam;
  sheet.hidden = cam;
  shutter.classList.toggle('again', !cam);
  renderShutter();
  if (cam) {
    runId++;
    busy = false;
    photo = null;
    detections = [];
    setStatus(null);
    if (!stream) startCamera();
    else cameraMsg.hidden = true;
  } else {
    cameraMsg.hidden = true;
  }
}

// ---------- rendering ----------
function renderShutter() {
  const label = t(mode === 'camera' ? 'shoot' : 'again');
  shutter.setAttribute('aria-label', label);
  shutterLabel.textContent = label;
}

const visible = () => detections.filter((d) => !removed.has(d.id));

function drawOverlay() {
  if (!photo) return;
  shot.width = photo.width;
  shot.height = photo.height;
  const ctx = shot.getContext('2d')!;
  ctx.drawImage(photo, 0, 0);
  for (const d of visible()) {
    const bw = d.bbox.x1 - d.bbox.x0;
    const bh = d.bbox.y1 - d.bbox.y0;
    // A wide box is a line of upright text ("Bake at 350°F"): cover it exactly.
    // A squarish box is a tilted label on a plate/dumbbell: just pin a compact tag on it.
    const lineText = bw > bh * 1.5;
    const fontSize = Math.max(18, Math.min(lineText ? bh * 0.75 : bh * 0.35, shot.width / 12));
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const text = d.converted.text;
    const padX = fontSize * 0.4;
    const pad = Math.max(4, bh * 0.15);
    const textW = ctx.measureText(text).width + padX * 2;
    const w = lineText ? Math.max(textW, bw + pad * 2) : textW;
    const hh = lineText ? Math.max(fontSize * 1.35, bh + pad * 2) : fontSize * 1.35;
    const cx = (d.bbox.x0 + d.bbox.x1) / 2;
    const cy = (d.bbox.y0 + d.bbox.y1) / 2;
    const x = Math.min(Math.max(0, cx - w / 2), shot.width - w);
    const y = Math.min(Math.max(0, cy - hh / 2), shot.height - hh);
    ctx.fillStyle = '#c6ff3d';
    ctx.beginPath();
    ctx.roundRect(x, y, w, hh, fontSize * 0.3);
    ctx.fill();
    ctx.fillStyle = '#0b0d10';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + hh / 2 + fontSize * 0.04);
  }
}

function sourceText(d: Detection): string {
  // Guessed plates have no unit in the text; OCR misreads like "1b" are shown normalized.
  if (d.match.assumed || d.match.unit.id === 'lb') return formatQuantity(d.match.value, d.match.unit, d.match.valueTo);
  return d.match.raw.replace(/\s+/g, ' ').trim();
}

function renderList() {
  resultsEl.innerHTML = '';
  for (const d of visible()) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="from">${escapeHtml(sourceText(d))}</span>
      <span class="eq">=</span>
      <span class="to">${escapeHtml(d.converted.text)}</span>
      <button class="remove" type="button" aria-label="${escapeHtml(t('remove.label'))}">×</button>`;
    li.querySelector('button')!.onclick = () => {
      removed.add(d.id);
      render();
    };
    resultsEl.appendChild(li);
  }
  const none = !busy && photo !== null && visible().length === 0;
  emptyEl.hidden = !none;
  emptyEl.textContent = detections.length
    ? t('empty.removed')
    : t('empty.none');
}

function renderSummary() {
  const all = visible();
  const masses = all.filter((d) => d.converted.unit.category === 'mass');
  // Only talk about barbells when the photo is just plates (not dumbbells, not a recipe).
  const platesOnly = masses.length === all.length && masses.every((d) => d.match.unit.id === 'lb' && LB_PLATES.has(d.match.value));
  if (!masses.length || !platesOnly) {
    summaryEl.hidden = true;
    summaryEl.innerHTML = '';
    return;
  }
  const sumKg = masses.reduce((acc, d) => acc + convertValue(d.converted.value, d.converted.unit, UNITS.kg), 0);
  const barbellKg = sumKg * 2 + BAR_KG;
  const kg = (v: number) => formatQuantity(v, UNITS.kg);
  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    ${masses.length > 1 ? `<div class="sum-row"><span>${escapeHtml(t('sum.plates', { n: masses.length }))}</span><strong>${kg(sumKg)}</strong></div>` : ''}
    <div class="sum-row barbell">
      <span>${escapeHtml(t('sum.barbell'))}<small>${escapeHtml(t('sum.bar', { bar: BAR_KG }))}</small></span>
      <strong>${kg(barbellKg)}</strong>
    </div>`;
}

function render() {
  drawOverlay();
  renderList();
  renderSummary();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------- controls ----------
shutter.onclick = () => {
  if (mode === 'photo') {
    setMode('camera');
    return;
  }
  if (video.videoWidth) analyze(captureGuide());
  else fileInput.click();
};
fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    analyze(scaledCanvas(bmp, 0, 0, bmp.width, bmp.height));
    bmp.close();
  } catch {
    setStatus('status.badImage');
  }
};

// ---------- manual input ----------
// A bare number means pounds: "225" → 102.1 kg. Units can still be typed ("350f", "5'11").
function renderManual() {
  const text = manualInput.value.trim();
  if (!text) {
    manualOut.textContent = '';
    return;
  }
  const res = convertText(text, TARGET, { assumeUnit: 'lb' });
  manualOut.textContent = res.length
    ? res.map((r) => `${formatQuantity(r.match.value, r.match.unit, r.match.valueTo)} = ${r.converted.text}`).join(' · ')
    : '';
}
manualInput.addEventListener('input', renderManual);
$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  manualInput.blur();
});

// ---------- language ----------
const langButtons = document.querySelectorAll<HTMLButtonElement>('#lang [data-locale]');
function renderLocale() {
  applyStatic();
  langButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.locale === getLocale())));
  renderShutter();
  renderStatus();
  if (cameraMsgKey) cameraMsg.textContent = t(cameraMsgKey);
  render();
}
langButtons.forEach((b) =>
  b.addEventListener('click', () => {
    setLocale(b.dataset.locale as Locale);
    renderLocale();
  }),
);

// ---------- boot ----------
renderLocale();
setMode('camera');
// Load the OCR models in the background so the first shot is fast.
const warm = () =>
  warmUp()
    .then(() => (modelsReady = true))
    .catch((e) => console.warn('OCR warm-up failed', e));
if ('requestIdleCallback' in window) requestIdleCallback(warm);
else setTimeout(warm, 500);

registerSW({ immediate: true });
