import { describe, expect, it } from 'vitest';
import { detect, groupWords, type OcrWord } from './layout';

const w = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90): OcrWord => ({
  text,
  bbox: { x0, y0, x1, y1 },
  confidence,
});

describe('groupWords', () => {
  it('joins words on the same row and splits far-apart ones', () => {
    const segs = groupWords([w('LB', 160, 102, 220, 150), w('45', 100, 100, 150, 150), w('25', 800, 100, 850, 150)]);
    expect(segs.map((s) => s.text)).toEqual(['45 LB', '25']);
  });

  it('keeps different rows apart', () => {
    const segs = groupWords([w('45', 100, 100, 150, 150), w('LB', 100, 300, 150, 350)]);
    expect(segs).toHaveLength(2);
  });

  it('joins a unit printed under the number, like on weight plates', () => {
    const segs = groupWords([w('45', 99, 88, 314, 228), w('LB', 154, 292, 264, 354)]);
    expect(segs.map((s) => s.text)).toEqual(['45 LB']);
  });

  it('does not join a number with an unrelated word below', () => {
    const segs = groupWords([w('45', 99, 88, 314, 228), w('Bake', 154, 292, 400, 354)]);
    expect(segs.map((s) => s.text)).toEqual(['45', 'Bake']);
  });
});

describe('detect', () => {
  it('places the conversion over the union of matched words', () => {
    const [d] = detect([w('45', 100, 100, 150, 150), w('LB', 160, 102, 220, 152, 70)], 'metric');
    expect(d.converted.text).toBe('20.4 kg');
    expect(d.bbox).toEqual({ x0: 100, y0: 100, x1: 220, y1: 152 });
    expect(d.confidence).toBe(70);
  });

  it('uses the assumed unit for bare plate numbers', () => {
    const ds = detect([w('45', 100, 100, 150, 150), w('10', 900, 100, 950, 150)], 'metric', { assumeUnit: 'lb' });
    expect(ds.map((d) => d.converted.text)).toEqual(['20.4 kg', '4.54 kg']);
  });

  it('collapses duplicate reads of the same value from different OCR passes', () => {
    const ds = detect([w('25', 100, 100, 150, 150, 80), w('25', 104, 98, 152, 149, 60), w('25', 600, 100, 650, 150)], 'metric', {
      assumeUnit: 'lb',
    });
    expect(ds).toHaveLength(2);
    expect(ds[0].confidence).toBe(80);
  });

  it('prefers a read unit over an assumed one at the same spot', () => {
    const ds = detect([w('45', 100, 100, 150, 150, 95), w('45LB', 98, 100, 160, 150, 60)], 'metric', { assumeUnit: 'lb' });
    expect(ds).toHaveLength(1);
    expect(ds[0].match.assumed).toBeFalsy();
  });

  it('guesses lone plate-sized numbers as lb, but nothing else', () => {
    const ds = detect(
      [w('45', 100, 100, 150, 150), w('25', 600, 100, 650, 150), w('37', 1100, 100, 1150, 150), w('Bake', 100, 400, 200, 450), w('10', 220, 400, 260, 450), w('min', 280, 400, 340, 450)],
      'metric',
      { guessPlates: true },
    );
    expect(ds.map((d) => d.converted.text)).toEqual(['20.4 kg', '11.3 kg']);
  });
});
