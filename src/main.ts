import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { detect, overlapRatio, type Detection, type OcrWord } from './layout';
import { getWorker, onOcrProgress, preprocess, recognizeWords, type Variant } from './ocr';
import { convertText, convertValue, formatQuantity, UNITS, type System } from './units';

// ---------- settings ----------
type Assume = '' | 'lb' | 'kg';
interface Settings {
  target: System;
  assume: Assume;
  barbell: boolean;
}

const SETTINGS_KEY = 'uniffy.settings';
function loadSettings(): Settings {
  const defaults: Settings = { target: 'metric', assume: '', barbell: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode etc. */
  }
}
const settings = loadSettings();

// ---------- elements ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const shot = $<HTMLCanvasElement>('shot');
const statusEl = $('status');
const cameraMsg = $('camera-msg');
const sheet = $('sheet');
const resultsEl = $('results');
const summaryEl = $('summary');
const emptyEl = $('empty');
const shutter = $<HTMLButtonElement>('shutter');
const retake = $<HTMLButtonElement>('retake');
const fileInput = $<HTMLInputElement>('file');
const targetChip = $<HTMLButtonElement>('target-chip');
const assumeChip = $<HTMLButtonElement>('assume-chip');
const manualInput = $<HTMLInputElement>('manual-input');
const manualOut = $('manual-out');

// ---------- state ----------
let photo: HTMLCanvasElement | null = null;
let words: OcrWord[] = [];
let detections: Detection[] = [];
const excluded = new Set<number>();
/** overlay label rectangles in photo pixels, for tap hit-testing */
const hits = new Map<number, [number, number, number, number]>();
let busy = false;
let runId = 0;

const MAX_DIM = 1600;

// ---------- status ----------
function setStatus(text: string | null) {
  statusEl.hidden = !text;
  statusEl.textContent = text ?? '';
}
const STATUS_KO: Record<string, string> = {
  'loading tesseract core': 'OCR 엔진 불러오는 중',
  'initializing tesseract': 'OCR 엔진 준비 중',
  'loading language traineddata': '언어 데이터 불러오는 중',
  'initializing api': 'OCR 준비 중',
};
onOcrProgress((status, progress) => {
  if (!busy || status === 'recognizing text') return;
  const label = STATUS_KO[status] ?? status;
  setStatus(`${label} ${Math.round(progress * 100)}%`);
});

// ---------- camera ----------
let stream: MediaStream | null = null;
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraMsg('이 브라우저는 카메라를 지원하지 않아요. 왼쪽 아래 버튼으로 사진을 불러오세요.');
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
        ? '카메라 권한이 막혀 있어요. 브라우저 설정에서 허용하거나, 왼쪽 아래 버튼으로 사진을 불러오세요.'
        : '카메라를 켤 수 없어요. 왼쪽 아래 버튼으로 사진을 불러오세요.',
    );
  }
}
function showCameraMsg(text: string) {
  cameraMsg.textContent = text;
  // The camera error can arrive after the user already opened a photo.
  cameraMsg.hidden = video.hidden;
}

function scaledCanvas(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// ---------- capture + OCR ----------
async function analyze(canvas: HTMLCanvasElement) {
  const id = ++runId;
  photo = canvas;
  words = [];
  detections = [];
  excluded.clear();
  showPhotoMode();
  render();

  busy = true;
  shutter.disabled = true;
  try {
    setStatus('OCR 준비 중');
    const passes: [Variant, string][] = [
      ['plain', '글자 읽는 중'],
      ['light-text', '원판 글씨 찾는 중'],
      ['dark-text', '한 번 더 찾는 중'],
    ];
    for (const [variant, label] of passes) {
      setStatus(label);
      const found = await recognizeWords(preprocess(canvas, variant));
      if (id !== runId) return;
      words = mergeWords(words, found);
      recompute();
    }
    setStatus(null);
  } catch (err) {
    console.error(err);
    if (id === runId) setStatus('OCR 실패: 새로고침 후 다시 시도해주세요');
  } finally {
    if (id === runId) {
      busy = false;
      shutter.disabled = false;
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

function recompute() {
  detections = detect(words, settings.target, { assumeUnit: settings.assume || undefined });
  // Open the app with #debug to inspect raw OCR words in the console.
  if (location.hash === '#debug') console.log('[uniffy] words', JSON.stringify(words));
  render();
}

// ---------- rendering ----------
function showPhotoMode() {
  video.hidden = true;
  shot.hidden = false;
  sheet.hidden = false;
  retake.disabled = false;
  cameraMsg.hidden = true;
}

function showCameraMode() {
  runId++;
  busy = false;
  shutter.disabled = false;
  setStatus(null);
  photo = null;
  detections = [];
  video.hidden = false;
  shot.hidden = true;
  sheet.hidden = true;
  retake.disabled = true;
  if (stream) cameraMsg.hidden = true;
  else startCamera();
}

const ACCENT = '#c6ff3d';

function drawOverlay() {
  if (!photo) return;
  shot.width = photo.width;
  shot.height = photo.height;
  const ctx = shot.getContext('2d')!;
  ctx.drawImage(photo, 0, 0);
  hits.clear();
  if (detections.length) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, shot.width, shot.height);
  }
  for (const d of detections) {
    const on = !excluded.has(d.id);
    const bh = d.bbox.y1 - d.bbox.y0;
    const fontSize = Math.max(18, Math.min(bh * 0.9, shot.width / 8));
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(d.converted.text).width;
    const padX = fontSize * 0.35;
    const w = Math.max(d.bbox.x1 - d.bbox.x0, tw + padX * 2);
    const hh = Math.max(bh, fontSize * 1.3);
    const cx = (d.bbox.x0 + d.bbox.x1) / 2;
    const cyy = (d.bbox.y0 + d.bbox.y1) / 2;
    const x = Math.min(Math.max(0, cx - w / 2), shot.width - w);
    const y = Math.min(Math.max(0, cyy - hh / 2), shot.height - hh);
    ctx.globalAlpha = on ? 1 : 0.45;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.roundRect(x, y, w, hh, fontSize * 0.25);
    ctx.fill();
    ctx.fillStyle = '#0b0d10';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.converted.text, x + w / 2, y + hh / 2 + fontSize * 0.04);
    ctx.globalAlpha = 1;
    hits.set(d.id, [x, y, w, hh]);
  }
}

function massUnitFor(target: System) {
  return target === 'metric' ? UNITS.kg : UNITS.lb;
}

function renderSummary() {
  const unit = massUnitFor(settings.target);
  const masses = detections.filter((d) => !excluded.has(d.id) && d.converted.unit.category === 'mass');
  if (!masses.length) {
    summaryEl.innerHTML = '';
    summaryEl.hidden = true;
    return;
  }
  summaryEl.hidden = false;
  const sum = masses.reduce((acc, d) => acc + convertValue(d.converted.value, d.converted.unit, unit), 0);
  const bar = settings.target === 'metric' ? 20 : 45;
  const total = sum * 2 + bar;
  summaryEl.innerHTML = `
    <div class="sum-row">
      <span>합계 <small>(${masses.length}개)</small></span>
      <strong>${formatQuantity(sum, unit)}</strong>
    </div>
    <label class="barbell">
      <input type="checkbox" id="barbell" ${settings.barbell ? 'checked' : ''} />
      <span>바벨로 계산 <small>(한쪽 원판 × 2 + 바 ${bar}${unit.symbol})</small></span>
      ${settings.barbell ? `<strong>${formatQuantity(total, unit)}</strong>` : ''}
    </label>`;
  summaryEl.querySelector<HTMLInputElement>('#barbell')!.onchange = (e) => {
    settings.barbell = (e.target as HTMLInputElement).checked;
    saveSettings();
    renderSummary();
  };
}

function renderList() {
  resultsEl.innerHTML = '';
  for (const d of detections) {
    const li = document.createElement('li');
    li.className = excluded.has(d.id) ? 'off' : '';
    const from = d.match.assumed ? `${d.match.raw} <em>${d.match.unit.symbol}?</em>` : escapeHtml(d.match.raw);
    li.innerHTML = `
      <span class="check" aria-hidden="true"></span>
      <span class="from">${from}</span>
      <span class="arrow">→</span>
      <span class="to">${escapeHtml(d.converted.text)}</span>`;
    li.onclick = () => toggle(d.id);
    resultsEl.appendChild(li);
  }
  emptyEl.hidden = busy || detections.length > 0 || !photo;
}

function render() {
  drawOverlay();
  renderList();
  renderSummary();
}

function toggle(id: number) {
  if (excluded.has(id)) excluded.delete(id);
  else excluded.add(id);
  render();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// Tap an overlay label on the photo to include/exclude it from the sum.
shot.addEventListener('click', (e) => {
  const rect = shot.getBoundingClientRect();
  const scale = Math.min(rect.width / shot.width, rect.height / shot.height);
  const ox = rect.left + (rect.width - shot.width * scale) / 2;
  const oy = rect.top + (rect.height - shot.height * scale) / 2;
  const px = (e.clientX - ox) / scale;
  const py = (e.clientY - oy) / scale;
  for (const [id, [x, y, w, h]] of hits) {
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      toggle(id);
      return;
    }
  }
});

// ---------- chips ----------
function renderChips() {
  targetChip.textContent = settings.target === 'metric' ? '→ kg · °C · cm' : '→ lb · °F · in';
  const assumeLabel = settings.assume ? `숫자만: ${settings.assume}` : '숫자만: 무시';
  assumeChip.textContent = assumeLabel;
  assumeChip.classList.toggle('active', !!settings.assume);
}
targetChip.onclick = () => {
  settings.target = settings.target === 'metric' ? 'imperial' : 'metric';
  if (settings.assume) settings.assume = settings.target === 'metric' ? 'lb' : 'kg';
  saveSettings();
  renderChips();
  recompute();
  renderManual();
};
assumeChip.onclick = () => {
  const source: Assume = settings.target === 'metric' ? 'lb' : 'kg';
  settings.assume = settings.assume ? '' : source;
  saveSettings();
  renderChips();
  recompute();
  renderManual();
};

// ---------- controls ----------
shutter.onclick = () => {
  if (busy) return;
  if (!video.hidden && video.videoWidth) {
    analyze(scaledCanvas(video, video.videoWidth, video.videoHeight));
  } else if (video.hidden) {
    showCameraMode();
  } else {
    fileInput.click();
  }
};
retake.onclick = showCameraMode;
fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    analyze(scaledCanvas(bmp, bmp.width, bmp.height));
    bmp.close();
  } catch {
    setStatus('이미지를 열 수 없어요');
  }
};

// ---------- manual input ----------
function renderManual() {
  const text = manualInput.value;
  if (!text.trim()) {
    manualOut.textContent = '';
    return;
  }
  const res = convertText(text, settings.target, { assumeUnit: settings.assume || undefined });
  manualOut.textContent = res.length ? res.map((r) => r.converted.text).join(' · ') : '단위를 못 찾았어요';
}
manualInput.addEventListener('input', renderManual);
$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  manualInput.blur();
});

// ---------- boot ----------
renderChips();
startCamera();
// Warm up OCR in the background so the first shot is fast.
const warm = () => getWorker().catch((e) => console.warn('OCR warm-up failed', e));
if ('requestIdleCallback' in window) requestIdleCallback(warm);
else setTimeout(warm, 500);

registerSW({ immediate: true });
