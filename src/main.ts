import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { detect, overlapRatio, type Detection, type OcrWord } from './layout';
import { getWorker, onOcrProgress, preprocess, recognizeWords, type Variant } from './ocr';
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

// ---------- status ----------
function setStatus(text: string | null) {
  statusEl.hidden = !text;
  statusEl.textContent = text ?? '';
}
onOcrProgress((status, progress) => {
  // Only the first run downloads the engine; show that so the wait makes sense.
  if (!busy || status === 'recognizing text') return;
  setStatus(`처음 한 번만 준비 중… ${Math.round(progress * 100)}%`);
});

// ---------- camera ----------
let stream: MediaStream | null = null;
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraMsg('이 브라우저에서는 카메라를 못 써요.\n왼쪽 아래 "앨범"으로 사진을 골라주세요.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    cameraMsg.hidden = true;
  } catch (err) {
    const name = (err as DOMException)?.name;
    showCameraMsg(
      name === 'NotAllowedError'
        ? '카메라 권한이 꺼져 있어요.\n브라우저 설정에서 카메라를 허용하거나, 왼쪽 아래 "앨범"으로 사진을 골라주세요.'
        : '카메라를 켤 수 없어요.\n왼쪽 아래 "앨범"으로 사진을 골라주세요.',
    );
  }
}
function showCameraMsg(text: string) {
  cameraMsg.textContent = text;
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
    const passes: Variant[] = ['plain', 'light-text', 'dark-text'];
    for (let i = 0; i < passes.length; i++) {
      setStatus(`읽는 중… ${i + 1}/${passes.length}`);
      const found = await recognizeWords(preprocess(canvas, passes[i]));
      if (id !== runId) return;
      words = mergeWords(words, found);
      detections = detect(words, TARGET, { guessPlates: true });
      render();
    }
    if (location.hash === '#debug') console.log('[uniffy] words', JSON.stringify(words));
    setStatus(null);
  } catch (err) {
    console.error(err);
    if (id === runId) setStatus('읽기 실패. 새로고침 후 다시 해주세요');
  } finally {
    if (id === runId) {
      busy = false;
      render();
    }
  }
}

/** Same word seen by several OCR passes: keep the most confident read. */
function mergeWords(a: OcrWord[], b: OcrWord[]): OcrWord[] {
  const out = [...a];
  for (const w of b) {
    const key = w.text.toLowerCase();
    const i = out.findIndex((o) => o.text.toLowerCase() === key && overlapRatio(o.bbox, w.bbox) > 0.5);
    if (i === -1) out.push(w);
    else if (w.confidence > out[i].confidence) out[i] = w;
  }
  return out;
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
  shutter.setAttribute('aria-label', cam ? '찍기' : '다시 찍기');
  shutterLabel.textContent = cam ? '찍기' : '다시 찍기';
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
const visible = () => detections.filter((d) => !removed.has(d.id));

function drawOverlay() {
  if (!photo) return;
  shot.width = photo.width;
  shot.height = photo.height;
  const ctx = shot.getContext('2d')!;
  ctx.drawImage(photo, 0, 0);
  for (const d of visible()) {
    const bh = d.bbox.y1 - d.bbox.y0;
    const fontSize = Math.max(20, Math.min(bh * 0.75, shot.width / 7));
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const text = d.converted.text;
    const padX = fontSize * 0.4;
    // Always fully cover the original text so it does not peek out around the label.
    const pad = Math.max(4, bh * 0.15);
    const w = Math.max(ctx.measureText(text).width + padX * 2, d.bbox.x1 - d.bbox.x0 + pad * 2);
    const hh = Math.max(fontSize * 1.35, bh + pad * 2);
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
      <button class="remove" type="button" aria-label="이 결과 빼기">×</button>`;
    li.querySelector('button')!.onclick = () => {
      removed.add(d.id);
      render();
    };
    resultsEl.appendChild(li);
  }
  const none = !busy && photo !== null && visible().length === 0;
  emptyEl.hidden = !none;
  emptyEl.textContent = detections.length
    ? '결과를 다 뺐어요. "다시 찍기"를 눌러주세요.'
    : '숫자를 못 찾았어요. 숫자가 네모 안에 크고 똑바로 들어오게 다시 찍어보세요. 아래 칸에 직접 입력해도 돼요.';
}

function renderSummary() {
  const all = visible();
  const masses = all.filter((d) => d.converted.unit.category === 'mass');
  // Only talk about barbells when the photo is just weights (not a recipe with "45 lb" in it).
  if (!masses.length || masses.length !== all.length) {
    summaryEl.hidden = true;
    summaryEl.innerHTML = '';
    return;
  }
  const sumKg = masses.reduce((acc, d) => acc + convertValue(d.converted.value, d.converted.unit, UNITS.kg), 0);
  const barbellKg = sumKg * 2 + BAR_KG;
  const kg = (v: number) => formatQuantity(v, UNITS.kg);
  summaryEl.hidden = false;
  summaryEl.innerHTML = `
    ${masses.length > 1 ? `<div class="sum-row"><span>원판 ${masses.length}장 합계</span><strong>${kg(sumKg)}</strong></div>` : ''}
    <div class="sum-row barbell">
      <span>바벨 양쪽에 똑같이 꽂으면<small>바 ${BAR_KG}kg 포함</small></span>
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
    setStatus('이미지를 열 수 없어요');
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

// ---------- boot ----------
setMode('camera');
// Warm up OCR in the background so the first shot is fast.
const warm = () => getWorker().catch((e) => console.warn('OCR warm-up failed', e));
if ('requestIdleCallback' in window) requestIdleCallback(warm);
else setTimeout(warm, 500);

registerSW({ immediate: true });
