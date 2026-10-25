import type { BookingStatus } from '@bookking/shared';
import { AppError } from '../../lib/errors.js';

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      409,
      'invalid_transition',
      `No se puede pasar una reserva de ${from} a ${to}.`,
      { from, to }
    );
  }
}
