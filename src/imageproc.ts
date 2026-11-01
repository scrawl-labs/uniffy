// Pure pixel helpers (no DOM) so they can be unit tested.
//
// Why: Tesseract drops text that sits inside a big enclosing shape (a weight
// plate's rim, a label border) because its layout analysis classifies the whole
// region as a picture. So we binarize locally and then erase connected
// components that are far too big (rims, holes, shadows) or too small (noise)
// to be characters.

/** Luma, contrast-stretched to 0..255, optionally inverted. */
export function toGray(rgba: Uint8ClampedArray, invert = false): Uint8ClampedArray {
  const n = rgba.length / 4;
  const gray = new Uint8ClampedArray(n);
  let min = 255;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const g = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    gray[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < n; i++) {
    const v = ((gray[i] - min) * 255) / range;
    gray[i] = invert ? 255 - v : v;
  }
  return gray;
}

/**
 * Local-mean threshold (Bradley). Returns a mask where 1 = ink (darker than its
 * neighbourhood by more than `offset`).
 */
export function adaptiveThreshold(gray: Uint8ClampedArray, w: number, h: number, offset = 10): Uint8Array {
  const r = Math.max(7, Math.floor(Math.min(w, h) / 16));
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      if (gray[y * w + x] < mean - offset) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/**
 * Removes 8-connected ink components whose bounding box is not character-like:
 * taller than `maxHeightFrac` of the image, wider than `maxWidthFrac`, or with
 * fewer than `minArea` pixels. Mutates and returns `mask`.
 */
export function filterComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  { maxHeightFrac = 0.4, maxWidthFrac = 0.6, minArea = 12 } = {},
): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const members: number[] = [];
  const maxH = h * maxHeightFrac;
  const maxW = w * maxWidthFrac;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    members.length = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    while (sp) {
      const p = stack[--sp];
      members.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bh > maxH || bw > maxW || members.length < minArea) {
      for (const p of members) mask[p] = 0;
    }
  }
  return mask;
}

/** Mask (1 = ink) → RGBA black-on-white. */
export function maskToRgba(mask: Uint8Array, out: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 0 : 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}
