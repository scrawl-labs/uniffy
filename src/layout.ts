// Turns OCR words (text + box) into detections: converted values placed where the
// original text was. OCR engines often split "45 LB" into separate lines/blocks,
// so we regroup words ourselves by geometry before running the unit parser.

import { convertQuantity, findQuantities, type Converted, type FindOptions, type Match, type System } from './units';


export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: Box;
  confidence: number;
}

export interface Detection {
  id: number;
  match: Match;
  converted: Converted;
  bbox: Box;
  confidence: number;
}

interface Segment {
  text: string;
  /** for each word: [start, end) offset into text */
  spans: { start: number; end: number; word: OcrWord }[];
}

const h = (b: Box) => b.y1 - b.y0;
const cy = (b: Box) => (b.y0 + b.y1) / 2;

/** Group words into horizontal runs (rows split where the gap is large). */
export function groupWords(words: OcrWord[]): Segment[] {
  const clean = words.filter((w) => w.text.trim().length > 0 && h(w.bbox) > 0);
  const rows: OcrWord[][] = [];
  for (const w of [...clean].sort((a, b) => cy(a.bbox) - cy(b.bbox))) {
    const row = rows.find((r) => {
      const ref = r[r.length - 1].bbox;
      const tol = Math.max(h(ref), h(w.bbox)) * 0.5;
      return Math.abs(cy(ref) - cy(w.bbox)) <= tol;
    });
    if (row) row.push(w);
    else rows.push([w]);
  }

  const segments: Segment[] = [];
  for (const unsorted of rows) {
    const row = dropOverlappingDigits(unsorted.sort((a, b) => a.bbox.x0 - b.bbox.x0));
    let current: OcrWord[] = [];
    const flush = () => {
      if (!current.length) return;
      let text = '';
      const spans: Segment['spans'] = [];
      for (const word of current) {
        if (text) text += ' ';
        const start = text.length;
        text += word.text;
        spans.push({ start, end: text.length, word });
      }
      segments.push({ text, spans });
      current = [];
    };
    for (const w of row) {
      const prev = current[current.length - 1];
      if (prev) {
        const gap = w.bbox.x0 - prev.bbox.x1;
        const size = Math.max(h(prev.bbox), h(w.bbox));
        if (gap > size * 2.5) flush();
      }
      current.push(w);
    }
    flush();
  }
  return mergeStacked(segments);
}

/**
 * The detector sometimes cuts one label into two overlapping regions ("45" and
 * "5 LB" for a printed "45 LB"), so the same digits are read twice. When a number
 * overlaps its left neighbour and is just the end (or start) of it, keep the longer
 * number only. The unit next to it ("LB") stays and joins the right number.
 */
function dropOverlappingDigits(row: OcrWord[]): OcrWord[] {
  const out: OcrWord[] = [];
  for (const w of row) {
    const prev = out[out.length - 1];
    const isNum = (t: string) => /^\d+(\.\d+)?$/.test(t);
    if (prev && isNum(prev.text) && isNum(w.text)) {
      const ix = Math.min(prev.bbox.x1, w.bbox.x1) - Math.max(prev.bbox.x0, w.bbox.x0);
      const narrow = Math.min(prev.bbox.x1 - prev.bbox.x0, w.bbox.x1 - w.bbox.x0);
      const dup = prev.text.endsWith(w.text) || w.text.startsWith(prev.text) || w.text.endsWith(prev.text);
      if (ix > narrow * 0.4 && dup) {
        if (w.text.length > prev.text.length) out[out.length - 1] = w;
        continue;
      }
    }
    out.push(w);
  }
  return out;
}

/** True when the text is nothing but a unit, e.g. "LB", "kg", "lbs." */
function isBareUnit(text: string): boolean {
  if (!/^[A-Za-z°º.]{1,7}$/.test(text)) return false;
  const [m] = findQuantities(`1 ${text}`);
  return !!m && m.start === 0 && m.end >= text.length + 1;
}

function segBox(seg: Segment): Box {
  return unionBox(seg.spans.map((s) => s.word.bbox));
}

/**
 * Weight plates usually print the unit under the number ("45" over "LB").
 * Join a segment ending in a digit with a short unit-looking segment directly below it.
 */
function mergeStacked(segments: Segment[]): Segment[] {
  const used = new Set<Segment>();
  const out: Segment[] = [];
  for (const top of segments) {
    if (used.has(top)) continue;
    used.add(top);
    if (!/\d$/.test(top.text)) {
      out.push(top);
      continue;
    }
    const a = segBox(top);
    const below = segments.find((seg) => {
      if (used.has(seg) || !isBareUnit(seg.text)) return false;
      const b = segBox(seg);
      const gap = b.y0 - a.y1;
      const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      return gap >= -h(b) * 0.3 && gap < Math.max(h(a), h(b)) * 1.2 && overlapX > 0;
    });
    if (!below) {
      out.push(top);
      continue;
    }
    used.add(below);
    const offset = top.text.length + 1;
    out.push({
      text: `${top.text} ${below.text}`,
      spans: [...top.spans, ...below.spans.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset }))],
    });
  }
  return out;
}

function unionBox(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Intersection over the smaller box. */
export function overlapRatio(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const area = (r: Box) => Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
  return (ix * iy) / Math.min(area(a), area(b));
}

/**
 * Words come from several OCR passes, so the same printed value can be read
 * twice with slightly different boxes/text. Keep the best detection per spot:
 * a read unit beats an assumed one, then higher confidence wins.
 */
function dedupe(list: Detection[]): Detection[] {
  const score = (d: Detection) => (d.match.assumed ? 0 : 1000) + d.confidence;
  const kept: Detection[] = [];
  for (const d of [...list].sort((a, b) => score(b) - score(a))) {
    if (!kept.some((k) => overlapRatio(k.bbox, d.bbox) > 0.5)) kept.push(d);
  }
  // reading order: same row (centers within half a height) left→right, then top→bottom
  const sameRow = (a: Box, b: Box) => Math.abs(cy(a) - cy(b)) < Math.min(h(a), h(b)) / 2;
  return kept
    .sort((a, b) => (sameRow(a.bbox, b.bbox) ? a.bbox.x0 - b.bbox.x0 : cy(a.bbox) - cy(b.bbox)))
    .map((d, id) => ({ ...d, id }));
}

/** Standard pound plate sizes. A lone number with one of these values is almost certainly a plate. */
export const LB_PLATES = new Set([2.5, 5, 10, 25, 35, 45, 55, 100]);

export interface DetectOptions extends FindOptions {
  /**
   * Treat a number standing alone (nothing else on its line) as pounds when it looks like
   * a gym weight: a multiple of 2.5 from 2.5 to 150 (plates, dumbbells, kettlebells).
   */
  guessWeights?: boolean;
}

export function looksLikeWeight(text: string): boolean {
  if (!/^\d{1,3}(\.5)?$/.test(text)) return false;
  const v = Number(text);
  return v >= 2.5 && v <= 150 && Number.isInteger(v / 2.5);
}

export function detect(words: OcrWord[], target: System, opts: DetectOptions = {}): Detection[] {
  const out: Detection[] = [];
  let id = 0;
  for (const seg of groupWords(words)) {
    const matches = findQuantities(seg.text, opts);
    // Only guess on rows made of numbers and units ("40 LB 45"), never inside prose ("Bake 10 min").
    const numbersOnly = seg.spans.every((sp) => /^[\d.]+$/.test(sp.word.text) || isBareUnit(sp.word.text) || findQuantities(sp.word.text).length > 0);
    if (opts.guessWeights && numbersOnly) {
      // Any lone word that looks like a gym weight and is not already part of a match ("45" next to "40 LB").
      for (const span of seg.spans) {
        if (!looksLikeWeight(span.word.text)) continue;
        if (matches.some((m) => m.start < span.end && span.start < m.end)) continue;
        const [m] = findQuantities(span.word.text, { assumeUnit: 'lb' });
        if (m) matches.push({ ...m, start: span.start + m.start, end: span.start + m.end });
      }
    }
    for (const match of matches) {
      const converted = convertQuantity(match, target);
      if (!converted) continue;
      const hit = seg.spans.filter((s) => s.start < match.end && match.start < s.end);
      if (!hit.length) continue;
      out.push({
        id: id++,
        match,
        converted,
        bbox: unionBox(hit.map((s) => s.word.bbox)),
        confidence: Math.min(...hit.map((s) => s.word.confidence)),
      });
    }
  }
  return dedupe(out);
}
