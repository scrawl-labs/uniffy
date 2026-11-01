import { describe, expect, it } from 'vitest';
import { adaptiveThreshold, filterComponents } from './imageproc';

function drawMask(w: number, h: number, paint: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (paint(x, y)) m[y * w + x] = 1;
  return m;
}
const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

describe('filterComponents', () => {
  it('removes a plate rim but keeps a glyph inside it', () => {
    const w = 200;
    const h = 200;
    const mask = drawMask(w, h, (x, y) => {
      const r = Math.hypot(x - 100, y - 100);
      const rim = r > 85 && r < 95;
      const glyph = x >= 90 && x < 110 && y >= 85 && y < 115 && (x < 95 || y < 90);
      return rim || glyph;
    });
    const glyphPixels = count(drawMask(w, h, (x, y) => x >= 90 && x < 110 && y >= 85 && y < 115 && (x < 95 || y < 90)));
    filterComponents(mask, w, h);
    expect(count(mask)).toBe(glyphPixels);
  });

  it('removes specks', () => {
    const mask = drawMask(50, 50, (x, y) => x === 10 && y === 10);
    filterComponents(mask, 50, 50);
    expect(count(mask)).toBe(0);
  });
});

describe('adaptiveThreshold', () => {
  it('marks dark strokes on a light patch regardless of global brightness', () => {
    const w = 120;
    const h = 120;
    const gray = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const base = x < 60 ? 220 : 90; // two very different backgrounds
        const stroke = (x === 30 || x === 90) && y > 40 && y < 80;
        gray[y * w + x] = stroke ? base - 60 : base;
      }
    const mask = adaptiveThreshold(gray, w, h);
    expect(mask[60 * w + 30]).toBe(1);
    expect(mask[60 * w + 90]).toBe(1);
    expect(mask[10 * w + 10]).toBe(0);
    expect(mask[10 * w + 100]).toBe(0);
  });
});
