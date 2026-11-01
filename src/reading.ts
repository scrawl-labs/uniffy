// Scoring one OCR reading of a region. Pure functions, no DOM — unit tested.
import { looksLikeWeight } from './layout';
import { findQuantities } from './units';

/** Keep only characters that can appear in a weight/unit reading (the model's dictionary is CJK-heavy). */
export function clean(text: string): string {
  return text.replace(/[^0-9A-Za-z.,°'"\/ -]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Plates print the unit under the number with a gap, and the recognizer often
 * reads a speck or the edge of the hole in that gap as a stray letter: "45 O LB".
 * Drop one lone character sitting between a number and a unit.
 */
function dropStrayBetween(text: string): string | null {
  const m = text.match(/^(\d+(?:\.\d+)?) [A-Za-z0-9'".,-] ([A-Za-z°.]{1,5})$/);
  if (!m) return null;
  const joined = `${m[1]} ${m[2]}`;
  return findQuantities(joined).length ? joined : null;
}

/**
 * Turn a raw reading into the text we keep and a score:
 * - number + unit ("45 LB") → full text, bonus
 * - number + stray character + unit ("45 O LB") → "45 LB", a smaller bonus
 * - a single number with some junk ("L40") → just the number, penalised by how much junk there was
 * - anything else → rejected
 */
export function interpret(raw: string, confidence: number): { text: string; score: number } {
  const text = clean(raw);
  if (findQuantities(text).length) return { text, score: confidence + 0.1 };
  const repaired = dropStrayBetween(text);
  if (repaired) return { text: repaired, score: confidence + 0.05 };
  const nums = text.match(/\d+(?:\.\d+)?/g) ?? [];
  if (nums.length !== 1) return { text, score: -1 };
  const purity = nums[0].length / Math.max(1, text.replace(/\s/g, '').length);
  // A bare number that is not a plausible gym weight ("408" = "40 LB" with LB read as 8) is suspect.
  const plausible = looksLikeWeight(nums[0]) ? 1 : 0.8;
  return { text: nums[0], score: confidence * (0.7 + 0.3 * purity) * plausible };
}
