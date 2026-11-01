import { describe, expect, it } from 'vitest';
import { convertText, findQuantities, parseNumber, UNITS, convertValue } from './units';

const conv = (text: string, target: 'metric' | 'imperial' = 'metric', assumeUnit?: string) =>
  convertText(text, target, { assumeUnit }).map((r) => r.converted.text);

describe('parseNumber', () => {
  it('handles thousands separators, decimals and fractions', () => {
    expect(parseNumber('1,000')).toBe(1000);
    expect(parseNumber('2.5')).toBe(2.5);
    expect(parseNumber('1/2')).toBe(0.5);
    expect(parseNumber('1 1/2')).toBe(1.5);
  });
});

describe('gym weights', () => {
  it('converts plate markings', () => {
    expect(conv('45 LB')).toEqual(['20.4 kg']);
    expect(conv('45LB')).toEqual(['20.4 kg']);
    expect(conv('225 lbs')).toEqual(['102.1 kg']);
    expect(conv('2.5 lb')).toEqual(['1.13 kg']);
  });

  it('tolerates common OCR misreads of "lb"', () => {
    expect(conv('45 1b')).toEqual(['20.4 kg']);
    expect(conv('35 IB')).toEqual(['15.9 kg']);
    expect(conv('25 1bs')).toEqual(['11.3 kg']);
  });

  it('assumes a unit for bare numbers in gym mode only', () => {
    expect(conv('45')).toEqual([]);
    expect(conv('45', 'metric', 'lb')).toEqual(['20.4 kg']);
    expect(conv('45  25  10', 'metric', 'lb')).toEqual(['20.4 kg', '11.3 kg', '4.54 kg']);
    // OCR junk between plates must not swallow a number
    expect(conv('45 J 25', 'metric', 'lb')).toEqual(['20.4 kg', '11.3 kg']);
    expect(conv('X200 3rd 45%', 'metric', 'lb')).toEqual([]);
  });

  it('does not re-convert numbers that already carry a metric unit', () => {
    expect(conv('20 KG', 'metric', 'lb')).toEqual([]);
    expect(conv('45 LB 20 KG', 'metric', 'lb')).toEqual(['20.4 kg']);
  });

  it('converts kg to lb for imperial target', () => {
    expect(conv('20 kg', 'imperial')).toEqual(['44.1 lb']);
  });
});

describe('temperature', () => {
  it('converts fahrenheit', () => {
    expect(conv('Bake at 350°F')).toEqual(['177°C']);
    expect(conv('350 °F')).toEqual(['177°C']);
    expect(conv('350F')).toEqual(['177°C']);
    expect(conv('350f')).toEqual(['177°C']);
    expect(conv('72 deg F')).toEqual(['22°C']);
    expect(conv('-40°F')).toEqual(['-40°C']);
  });

  it('ignores a spaced bare letter', () => {
    expect(conv('Row 350 F')).toEqual([]);
  });

  it('converts celsius to fahrenheit', () => {
    expect(conv('180°C', 'imperial')).toEqual(['356°F']);
  });
});

describe('length', () => {
  it('converts heights', () => {
    expect(conv(`5'11"`)).toEqual(['180 cm']);
    expect(conv('6ft 2in')).toEqual(['188 cm']);
    expect(conv('6 ft')).toEqual(['183 cm']);
  });

  it('converts inches and miles', () => {
    expect(conv('12 in')).toEqual(['30.5 cm']);
    expect(conv('26.2 miles')).toEqual(['42.2 km']);
  });

  it('does not treat the word "in" as inches', () => {
    expect(conv('5 in a row')).toEqual([]);
  });

  it('formats imperial heights nicely', () => {
    expect(conv('180 cm', 'imperial')).toEqual([`5'11"`]);
  });
});

describe('volume and speed', () => {
  it('converts recipe volumes', () => {
    expect(conv('2 cups')).toEqual(['473 ml']);
    expect(conv('1/2 cup')).toEqual(['118 ml']);
    expect(conv('16 fl oz')).toEqual(['473 ml']);
    expect(conv('1 gal')).toEqual(['3.79 L']);
    expect(conv('2 T')).toEqual(['30 ml']);
  });

  it('converts speed', () => {
    expect(conv('65 mph')).toEqual(['104.6 km/h']);
  });

  it('converts ranges', () => {
    expect(conv('10-12 lb')).toEqual(['4.54–5.44 kg']);
  });
});

describe('mass', () => {
  it('distinguishes oz from fl oz', () => {
    expect(conv('16 oz')).toEqual(['454 g']);
    expect(convertText('16 fl oz', 'metric')[0].match.unit.id).toBe('floz');
  });

  it('round-trips', () => {
    expect(convertValue(convertValue(100, UNITS.kg, UNITS.lb), UNITS.lb, UNITS.kg)).toBeCloseTo(100);
  });
});

describe('offsets', () => {
  it('reports character spans for overlay placement', () => {
    const [m] = findQuantities('Plate: 45 LB');
    expect([m.start, m.end]).toEqual([7, 12]);
  });
});
