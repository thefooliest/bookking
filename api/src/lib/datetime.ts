import { DateTime } from 'luxon';
import { env } from '../config/env.js';

export const OPENING_MINUTES = 7 * 60;
export const CLOSING_MINUTES = 21 * 60;
export const SLOT_MINUTES = 30;

export function parseDateTime(date: string, time: string): DateTime {
  return DateTime.fromISO(`${date}T${time}`, { zone: env.APP_TIME_ZONE });
}

export function minutesOfDay(dateTime: DateTime): number {
  return dateTime.hour * 60 + dateTime.minute;
}

export function formatTime(dateTime: DateTime): string {
  return dateTime.toFormat('HH:mm');
}
