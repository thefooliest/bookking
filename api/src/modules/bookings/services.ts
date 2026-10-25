import {
  EXTRA_SERVICES,
  type BookingExtraInput,
  type BookingServiceLine
} from '@bookking/shared';

export function buildServiceLines(extras: BookingExtraInput[]): BookingServiceLine[] {
  return extras.map((extra) => {
    const catalogItem = EXTRA_SERVICES.find((item) => item.code === extra.code);
    if (!catalogItem) {
      throw new Error(`Unknown extra service: ${extra.code}`);
    }

    return {
      code: catalogItem.code,
      label: catalogItem.label,
      quantity: extra.quantity,
      unitPrice: catalogItem.unitPrice,
      subtotal: catalogItem.unitPrice * extra.quantity
    };
  });
}

export function servicesTotal(lines: BookingServiceLine[]): number {
  return lines.reduce((total, line) => total + line.subtotal, 0);
}
