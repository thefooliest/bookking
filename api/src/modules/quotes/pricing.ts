import type { PriceBreakdown } from '@bookking/shared';

export const SATURDAY_SURCHARGE_PERCENT = 25;

type PriceInput = {
  hourlyRate: number;
  durationHours: number;
  isSaturday: boolean;
};

export function discountPercentFor(durationHours: number): number {
  if (durationHours >= 8) {
    return 20;
  }
  if (durationHours >= 4) {
    return 10;
  }
  return 0;
}

export function calculatePrice({
  hourlyRate,
  durationHours,
  isSaturday
}: PriceInput): PriceBreakdown {
  const base = Math.round(hourlyRate * durationHours);
  const discountPercent = discountPercentFor(durationHours);
  const discount = Math.round((base * discountPercent) / 100);
  const afterDiscount = base - discount;
  const surchargePercent = isSaturday ? SATURDAY_SURCHARGE_PERCENT : 0;
  const surcharge = Math.round((afterDiscount * surchargePercent) / 100);

  return {
    base,
    discount,
    discountPercent,
    surcharge,
    surchargePercent,
    total: afterDiscount + surcharge,
    currency: 'COP'
  };
}
