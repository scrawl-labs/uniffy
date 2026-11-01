// Unit parsing + conversion. Pure functions, no DOM — unit tested.

export type System = 'metric' | 'imperial';
export type Category = 'mass' | 'length' | 'temperature' | 'volume' | 'speed';

export interface UnitDef {
  id: string;
  symbol: string;
  category: Category;
  system: System;
  /** factor to the category base unit (kg, m, L, km/h). Unused for temperature. */
  factor: number;
}

export const UNITS: Record<string, UnitDef> = {
  kg: { id: 'kg', symbol: 'kg', category: 'mass', system: 'metric', factor: 1 },
  g: { id: 'g', symbol: 'g', category: 'mass', system: 'metric', factor: 0.001 },
  lb: { id: 'lb', symbol: 'lb', category: 'mass', system: 'imperial', factor: 0.45359237 },
  oz: { id: 'oz', symbol: 'oz', category: 'mass', system: 'imperial', factor: 0.028349523125 },

  mm: { id: 'mm', symbol: 'mm', category: 'length', system: 'metric', factor: 0.001 },
  cm: { id: 'cm', symbol: 'cm', category: 'length', system: 'metric', factor: 0.01 },
  m: { id: 'm', symbol: 'm', category: 'length', system: 'metric', factor: 1 },
  km: { id: 'km', symbol: 'km', category: 'length', system: 'metric', factor: 1000 },
  in: { id: 'in', symbol: 'in', category: 'length', system: 'imperial', factor: 0.0254 },
  ft: { id: 'ft', symbol: 'ft', category: 'length', system: 'imperial', factor: 0.3048 },
  yd: { id: 'yd', symbol: 'yd', category: 'length', system: 'imperial', factor: 0.9144 },
  mi: { id: 'mi', symbol: 'mi', category: 'length', system: 'imperial', factor: 1609.344 },

  C: { id: 'C', symbol: '°C', category: 'temperature', system: 'metric', factor: 1 },
  F: { id: 'F', symbol: '°F', category: 'temperature', system: 'imperial', factor: 1 },

  ml: { id: 'ml', symbol: 'ml', category: 'volume', system: 'metric', factor: 0.001 },
  L: { id: 'L', symbol: 'L', category: 'volume', system: 'metric', factor: 1 },
  floz: { id: 'floz', symbol: 'fl oz', category: 'volume', system: 'imperial', factor: 0.0295735295625 },
  cup: { id: 'cup', symbol: 'cup', category: 'volume', system: 'imperial', factor: 0.2365882365 },
  pt: { id: 'pt', symbol: 'pt', category: 'volume', system: 'imperial', factor: 0.473176473 },
  qt: { id: 'qt', symbol: 'qt', category: 'volume', system: 'imperial', factor: 0.946352946 },
  gal: { id: 'gal', symbol: 'gal', category: 'volume', system: 'imperial', factor: 3.785411784 },
  tbsp: { id: 'tbsp', symbol: 'tbsp', category: 'volume', system: 'imperial', factor: 0.01478676478125 },
  tsp: { id: 'tsp', symbol: 'tsp', category: 'volume', system: 'imperial', factor: 0.00492892159375 },

  kmh: { id: 'kmh', symbol: 'km/h', category: 'speed', system: 'metric', factor: 1 },
  mph: { id: 'mph', symbol: 'mph', category: 'speed', system: 'imperial', factor: 1.609344 },
};

/**
 * Text aliases → unit id. Includes common OCR misreads (1b / Ib for "lb").
 * Matched case-insensitively unless listed in CASE_SENSITIVE.
 */
const ALIASES: [string, string][] = [
  ['pounds', 'lb'], ['pound', 'lb'], ['lbs', 'lb'], ['lb', 'lb'], ['1bs', 'lb'], ['1b', 'lb'], ['ibs', 'lb'], ['ib', 'lb'],
  ['ounces', 'oz'], ['ounce', 'oz'], ['oz', 'oz'], ['0z', 'oz'],
  ['kilograms', 'kg'], ['kilogram', 'kg'], ['kgs', 'kg'], ['kg', 'kg'],
  ['grams', 'g'], ['gram', 'g'], ['g', 'g'],
  ['millimeters', 'mm'], ['mm', 'mm'],
  ['centimeters', 'cm'], ['cm', 'cm'],
  ['kilometers', 'km'], ['km', 'km'],
  ['meters', 'm'], ['meter', 'm'], ['m', 'm'],
  ['inches', 'in'], ['inch', 'in'], ['in', 'in'],
  ['feet', 'ft'], ['foot', 'ft'], ['ft', 'ft'],
  ['yards', 'yd'], ['yard', 'yd'], ['yds', 'yd'], ['yd', 'yd'],
  ['miles', 'mi'], ['mile', 'mi'], ['mi', 'mi'],
  ['fl. oz', 'floz'], ['fl oz', 'floz'], ['fl.oz', 'floz'], ['floz', 'floz'],
  ['cups', 'cup'], ['cup', 'cup'],
  ['pints', 'pt'], ['pint', 'pt'], ['pt', 'pt'],
  ['quarts', 'qt'], ['quart', 'qt'], ['qt', 'qt'],
  ['gallons', 'gal'], ['gallon', 'gal'], ['gal', 'gal'],
  ['tablespoons', 'tbsp'], ['tablespoon', 'tbsp'], ['tbsp', 'tbsp'], ['Tbsp', 'tbsp'], ['T', 'tbsp'],
  ['teaspoons', 'tsp'], ['teaspoon', 'tsp'], ['tsp', 'tsp'], ['t', 'tsp'],
  ['milliliters', 'ml'], ['ml', 'ml'],
  ['liters', 'L'], ['litres', 'L'], ['liter', 'L'], ['litre', 'L'], ['l', 'L'],
  ['mph', 'mph'], ['km/h', 'kmh'], ['kmh', 'kmh'], ['kph', 'kmh'],
];
const CASE_SENSITIVE = new Set(['T', 't', 'l']);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/ /g, '\\s?');
}

const sortedAliases = [...ALIASES].sort((a, b) => b[0].length - a[0].length);
const ciAlternation = sortedAliases.filter(([a]) => !CASE_SENSITIVE.has(a)).map(([a]) => escapeRe(a)).join('|');
const csAlternation = sortedAliases.filter(([a]) => CASE_SENSITIVE.has(a)).map(([a]) => escapeRe(a)).join('|');

const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;
const FRACTION = String.raw`(?:\d+\s+)?\d+\/\d+`;
const QTY = String.raw`(?:${FRACTION}|${NUM})`;
const RANGE_SEP = String.raw`\s*(?:-|–|~|to)\s*`;

// Feet + inches: 5'11", 5' 11, 6ft 2in
const FEET_INCHES_RE = new RegExp(
  String.raw`(?<![\d.])(\d{1,2})\s*(?:'|’|ft|feet)\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|”|''|in(?:ch(?:es)?)?)?(?![\w.])`,
  'gi',
);
// Temperatures: 350°F, 350 °F, 350F, 180ºC, 72 deg F
const TEMP_RE = new RegExp(
  String.raw`(?<![\d.])(-?${NUM})(?:${RANGE_SEP}(-?${NUM}))?(?:\s*(?:°|º|˚|\*|degrees|deg\.?)\s*([FCfc])|([FC]))(?![a-zA-Z])`,
  'g',
);
// Everything else: number (or range) + unit. Two regexes because a few aliases
// ("T" = tbsp, "t" = tsp) are case-sensitive.
const qtyUnitSource = (units: string) =>
  String.raw`(?<![\d.\/])(${QTY})(?:${RANGE_SEP}(${QTY}))?\s*(${units})(?![a-zA-Z])`;
const QTY_UNIT_RES = [new RegExp(qtyUnitSource(ciAlternation), 'gi'), new RegExp(qtyUnitSource(csAlternation), 'g')];
// Bare numbers (used only in "assume unit" mode, e.g. gym plates printed "45").
// Only text glued to the number disqualifies it ("X200", "3rd", "45%"); real units were already claimed above.
const BARE_RE = new RegExp(String.raw`(?<![\w.,\/])(${NUM})(?![\d.,\/]|[a-zA-Z°º%]|\s*[°º%])`, 'g');

export interface Quantity {
  value: number;
  /** upper bound when the text is a range like "10-12 lb" */
  valueTo?: number;
  unit: UnitDef;
}

export interface Match extends Quantity {
  /** start/end character offsets in the source text */
  start: number;
  end: number;
  raw: string;
  /** true when the unit was assumed (bare number) rather than read */
  assumed?: boolean;
}

export function parseNumber(s: string): number {
  s = s.trim();
  const frac = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (frac) {
    const whole = frac[1] ? Number(frac[1]) : 0;
    const den = Number(frac[3]);
    return den === 0 ? NaN : whole + Number(frac[2]) / den;
  }
  return Number(s.replace(/,/g, ''));
}

function aliasToUnit(alias: string): UnitDef | undefined {
  const norm = alias.replace(/\s+/g, ' ');
  for (const [a, id] of ALIASES) {
    if (CASE_SENSITIVE.has(a) ? a === norm : a.toLowerCase() === norm.toLowerCase()) return UNITS[id];
  }
  return undefined;
}

function overlaps(a: { start: number; end: number }, list: { start: number; end: number }[]): boolean {
  return list.some((b) => a.start < b.end && b.start < a.end);
}

export interface FindOptions {
  /** unit to assume for bare numbers (gym mode). */
  assumeUnit?: string;
}

/** Find every quantity with a unit in a piece of text. */
export function findQuantities(text: string, opts: FindOptions = {}): Match[] {
  const out: Match[] = [];
  const push = (m: Match) => {
    if (!Number.isFinite(m.value)) return;
    if (!overlaps(m, out)) out.push(m);
  };

  for (const m of text.matchAll(FEET_INCHES_RE)) {
    const ft = Number(m[1]);
    const inch = Number(m[2]);
    if (inch >= 12) continue;
    push({ value: ft * 12 + inch, unit: UNITS.in, start: m.index!, end: m.index! + m[0].length, raw: m[0] });
  }

  for (const m of text.matchAll(TEMP_RE)) {
    // Without a degree sign, "F"/"C" must be glued to the number ("350F").
    const unitId = (m[3] ?? m[4]).toUpperCase();
    push({
      value: parseNumber(m[1]),
      valueTo: m[2] !== undefined ? parseNumber(m[2]) : undefined,
      unit: UNITS[unitId],
      start: m.index!,
      end: m.index! + m[0].length,
      raw: m[0],
    });
  }

  for (const m of QTY_UNIT_RES.flatMap((re) => [...text.matchAll(re)])) {
    const alias = m[3];
    const unit = aliasToUnit(alias);
    if (!unit) continue;
    // "in" is also an English word: "5 in a row" — skip when followed by a lowercase word.
    if (unit.id === 'in' && /^in$/i.test(alias) && /^\s+[a-z]/.test(text.slice(m.index! + m[0].length))) continue;
    push({
      value: parseNumber(m[1]),
      valueTo: m[2] !== undefined ? parseNumber(m[2]) : undefined,
      unit,
      start: m.index!,
      end: m.index! + m[0].length,
      raw: m[0],
    });
  }

  if (opts.assumeUnit && UNITS[opts.assumeUnit]) {
    for (const m of text.matchAll(BARE_RE)) {
      const value = parseNumber(m[1]);
      if (!(value > 0 && value < 1000)) continue;
      push({
        value,
        unit: UNITS[opts.assumeUnit],
        start: m.index!,
        end: m.index! + m[0].length,
        raw: m[0],
        assumed: true,
      });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Preferred target unit for a source unit when converting to `target` system. */
function targetUnitFor(unit: UnitDef, value: number, target: System): UnitDef {
  if (target === 'metric') {
    switch (unit.id) {
      case 'lb': return UNITS.kg;
      case 'oz': return UNITS.g;
      case 'in': return value >= 39 ? UNITS.m : UNITS.cm;
      case 'ft': return UNITS.m;
      case 'yd': return UNITS.m;
      case 'mi': return UNITS.km;
      case 'F': return UNITS.C;
      case 'floz': case 'cup': case 'pt': case 'tbsp': case 'tsp': return UNITS.ml;
      case 'qt': case 'gal': return UNITS.L;
      case 'mph': return UNITS.kmh;
    }
  } else {
    switch (unit.id) {
      case 'kg': return UNITS.lb;
      case 'g': return value >= 453 ? UNITS.lb : UNITS.oz;
      case 'mm': case 'cm': return UNITS.in;
      case 'm': return UNITS.ft;
      case 'km': return UNITS.mi;
      case 'C': return UNITS.F;
      case 'ml': return UNITS.floz;
      case 'L': return value >= 3.785 ? UNITS.gal : UNITS.floz;
      case 'kmh': return UNITS.mph;
    }
  }
  return unit;
}

export function convertValue(value: number, from: UnitDef, to: UnitDef): number {
  if (from.category !== to.category) throw new Error(`cannot convert ${from.id} to ${to.id}`);
  if (from.category === 'temperature') {
    if (from.id === to.id) return value;
    return from.id === 'F' ? ((value - 32) * 5) / 9 : (value * 9) / 5 + 32;
  }
  return (value * from.factor) / to.factor;
}

export interface Converted {
  value: number;
  valueTo?: number;
  unit: UnitDef;
  text: string;
}

/** Returns null when the quantity is already in the target system. */
export function convertQuantity(q: Quantity, target: System): Converted | null {
  if (q.unit.system === target) return null;
  const to = targetUnitFor(q.unit, q.value, target);
  if (to === q.unit) return null;
  const value = convertValue(q.value, q.unit, to);
  const valueTo = q.valueTo !== undefined ? convertValue(q.valueTo, q.unit, to) : undefined;
  return { value, valueTo, unit: to, text: formatQuantity(value, to, valueTo) };
}

export function formatNumber(n: number, unit?: UnitDef): string {
  const abs = Math.abs(n);
  let digits: number;
  if (unit?.category === 'temperature') digits = 0;
  else if (abs >= 1000) digits = 0;
  else if (abs >= 10) digits = 1;
  else if (abs >= 1) digits = 2;
  else digits = 3;
  if (unit && (unit.id === 'g' || unit.id === 'ml' || unit.id === 'mm') && abs >= 10) digits = 0;
  if (unit && unit.id === 'cm' && abs >= 100) digits = 0;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function formatQuantity(value: number, unit: UnitDef, valueTo?: number): string {
  if (unit.id === 'in' && value >= 12 && valueTo === undefined) {
    // show heights as 5'11"
    const ft = Math.floor(value / 12);
    const inch = Math.round(value - ft * 12);
    return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`;
  }
  const sep = unit.category === 'temperature' ? '' : ' ';
  const num = valueTo !== undefined ? `${formatNumber(value, unit)}–${formatNumber(valueTo, unit)}` : formatNumber(value, unit);
  return `${num}${sep}${unit.symbol}`;
}

/** Convert free-form text (manual input box). */
export function convertText(text: string, target: System, opts: FindOptions = {}): { match: Match; converted: Converted }[] {
  return findQuantities(text, opts)
    .map((match) => ({ match, converted: convertQuantity(match, target) }))
    .filter((r): r is { match: Match; converted: Converted } => r.converted !== null);
}
