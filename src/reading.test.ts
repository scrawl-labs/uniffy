import { describe, expect, it } from 'vitest';
import { interpret } from './reading';

describe('interpret', () => {
  it('keeps a number with its unit and gives it a bonus', () => {
    expect(interpret('45 LB', 0.8)).toEqual({ text: '45 LB', score: expect.closeTo(0.9, 5) });
  });

  it('drops a stray character read between the number and the unit', () => {
    const r = interpret('45 O LB', 0.83);
    expect(r.text).toBe('45 LB');
    // must beat a confident misread from a rotated pass ("50" at 0.77)
    expect(r.score).toBeGreaterThan(interpret('50', 0.77).score);
  });

  it('does not invent a unit from plain words', () => {
    expect(interpret('45 O Bake', 0.9).text).toBe('45');
  });

  it('still falls back to a lone number', () => {
    expect(interpret('L40', 0.9).text).toBe('40');
  });
});
