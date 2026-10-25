import type { NextAvailableSlot, QuoteResponse } from '@bookking/shared';
import type { DateTime } from 'luxon';
import {
  CLOSING_MINUTES,
  OPENING_MINUTES,
  SLOT_MINUTES,
  formatTime,
  minutesOfDay,
  parseDateTime
} from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { findRoomById } from '../rooms/repo.js';
import { calculatePrice } from './pricing.js';
import type { QuoteRequestInput } from './schemas.js';
import { type BookingInterval, listConfirmedIntervals } from './repo.js';

function overlaps(startsAt: DateTime, endsAt: DateTime, interval: BookingInterval): boolean {
  return (
    startsAt.toMillis() < interval.endsAt.toMillis() &&
    endsAt.toMillis() > interval.startsAt.toMillis()
  );
}

function findNextAvailableSlot(
  startsAt: DateTime,
  durationMinutes: number,
  intervals: BookingInterval[]
): NextAvailableSlot | null {
  const closing = startsAt.startOf('day').set({ hour: 21, minute: 0, second: 0, millisecond: 0 });
  let cursor = startsAt.plus({ minutes: SLOT_MINUTES });

  while (cursor.plus({ minutes: durationMinutes }).toMillis() <= closing.toMillis()) {
    const end = cursor.plus({ minutes: durationMinutes });
    const hasOverlap = intervals.some((interval) => overlaps(cursor, end, interval));

    if (!hasOverlap) {
      return { startTime: formatTime(cursor), endTime: formatTime(end) };
    }

    cursor = cursor.plus({ minutes: SLOT_MINUTES });
  }

  return null;
}

export async function createQuote(input: QuoteRequestInput): Promise<QuoteResponse> {
  const room = await findRoomById(input.roomId);
  if (!room) {
    throw new AppError(404, 'room_not_found', 'La sala no existe');
  }

  const startsAt = parseDateTime(input.date, input.startTime);
  if (!startsAt.isValid) {
    throw new AppError(400, 'invalid_date', 'La fecha u hora no es válida');
  }

  const durationMinutes = Math.round(input.durationHours * 60);
  const endsAt = startsAt.plus({ minutes: durationMinutes });
  const price = calculatePrice({
    hourlyRate: room.hourlyRate,
    durationHours: input.durationHours,
    isSaturday: startsAt.weekday === 6
  });

  const quote: QuoteResponse = {
    room,
    date: input.date,
    startTime: formatTime(startsAt),
    endTime: formatTime(endsAt),
    durationHours: input.durationHours,
    ...price,
    available: false,
    reason: null,
    nextAvailable: null
  };

  if (startsAt.weekday === 7) {
    return { ...quote, reason: 'La sala no abre los domingos.' };
  }

  const startMinutes = minutesOfDay(startsAt);
  const endMinutes = startMinutes + durationMinutes;

  if (startMinutes < OPENING_MINUTES || endMinutes > CLOSING_MINUTES) {
    return {
      ...quote,
      reason: 'El horario debe estar entre las 07:00 y las 21:00.'
    };
  }

  const intervals = await listConfirmedIntervals(
    room.id,
    startsAt.startOf('day'),
    startsAt.startOf('day').plus({ days: 1 })
  );
  const hasOverlap = intervals.some((interval) => overlaps(startsAt, endsAt, interval));

  if (hasOverlap) {
    return {
      ...quote,
      reason: 'La sala ya está reservada en ese horario.',
      nextAvailable: findNextAvailableSlot(startsAt, durationMinutes, intervals)
    };
  }

  return { ...quote, available: true };
}
