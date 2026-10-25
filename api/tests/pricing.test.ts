import { describe, expect, it } from 'vitest';
import { calculatePrice, discountPercentFor } from '../src/modules/quotes/pricing.js';

describe('discountPercentFor', () => {
  it.each([
    [1, 0],
    [3.5, 0],
    [4, 10],
    [7.5, 10],
    [8, 20],
    [10, 20]
  ])('applies %s hours as %s%% discount', (durationHours, expected) => {
    expect(discountPercentFor(durationHours)).toBe(expected);
  });
});

describe('calculatePrice', () => {
  it('calculates a one hour room on a weekday', () => {
    expect(
      calculatePrice({ hourlyRate: 40000, durationHours: 1, isSaturday: false })
    ).toEqual({
      base: 40000,
      discount: 0,
      discountPercent: 0,
      surcharge: 0,
      surchargePercent: 0,
      total: 40000,
      currency: 'COP'
    });
  });

  it('applies the duration discount before the Saturday surcharge', () => {
    expect(
      calculatePrice({ hourlyRate: 40000, durationHours: 4, isSaturday: true })
    ).toEqual({
      base: 160000,
      discount: 16000,
      discountPercent: 10,
      surcharge: 36000,
      surchargePercent: 25,
      total: 180000,
      currency: 'COP'
    });
  });

  it('applies the 20 percent discount from eight hours', () => {
    expect(
      calculatePrice({ hourlyRate: 120000, durationHours: 8, isSaturday: false })
    ).toEqual({
      base: 960000,
      discount: 192000,
      discountPercent: 20,
      surcharge: 0,
      surchargePercent: 0,
      total: 768000,
      currency: 'COP'
    });
  });

  it('supports half hour blocks', () => {
    expect(
      calculatePrice({ hourlyRate: 70000, durationHours: 1.5, isSaturday: false })
    ).toEqual({
      base: 105000,
      discount: 0,
      discountPercent: 0,
      surcharge: 0,
      surchargePercent: 0,
      total: 105000,
      currency: 'COP'
    });
  });
});
