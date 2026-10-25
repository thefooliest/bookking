import { DateTime } from 'luxon';
import { env } from '../../config/env.js';

const WEEKDAYS: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7
};

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: env.APP_TIME_ZONE
});

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function nowInAppZone(): DateTime {
  return DateTime.now().setZone(env.APP_TIME_ZONE);
}

function validIsoDate(value: string): string | null {
  const parsed = DateTime.fromISO(value, { zone: env.APP_TIME_ZONE });
  return parsed.isValid ? parsed.toISODate() : null;
}

export function resolveDatePhrase(phrase: string, now = nowInAppZone()): string | null {
  const text = normalizeText(phrase);

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso?.[1]) {
    return validIsoDate(iso[1]);
  }

  if (/\bpasado\s+manana\b/.test(text)) {
    return now.plus({ days: 2 }).toISODate();
  }

  const withoutMorningPhrase = text.replace(/\b(?:en|de|por)\s+la\s+manana\b/g, '');
  if (/\bmanana\b/.test(withoutMorningPhrase)) {
    return now.plus({ days: 1 }).toISODate();
  }

  if (/\bhoy\b/.test(text)) {
    return now.toISODate();
  }

  const weekday = text.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (weekday?.[1]) {
    const target = WEEKDAYS[weekday[1]];
    if (target) {
      let delta = (target - now.weekday + 7) % 7;
      if (delta === 0) {
        delta = 7;
      }
      return now.plus({ days: delta }).toISODate();
    }
  }

  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/);
  if (numeric?.[1] && numeric[2]) {
    const year = numeric[3] ? Number(numeric[3]) : now.year;
    const parsed = DateTime.fromObject(
      {
        day: Number(numeric[1]),
        month: Number(numeric[2]),
        year
      },
      { zone: env.APP_TIME_ZONE }
    );
    if (parsed.isValid) {
      if (!numeric[3] && parsed < now.startOf('day')) {
        return parsed.plus({ years: 1 }).toISODate();
      }
      return parsed.toISODate();
    }
  }

  return null;
}

function buildTime(hour: number, minute: number, meridiem?: string): string | null {
  let normalizedHour = hour;
  if (meridiem === 'pm' && normalizedHour < 12) {
    normalizedHour += 12;
  }
  if (meridiem === 'am' && normalizedHour === 12) {
    normalizedHour = 0;
  }
  if (normalizedHour < 0 || normalizedHour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const totalMinutes = Math.round((normalizedHour * 60 + minute) / 30) * 30;
  const safeMinutes = totalMinutes % (24 * 60);
  const finalHour = Math.floor(safeMinutes / 60);
  const finalMinute = safeMinutes % 60;
  return `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;
}

export function extractTimeFromText(value: string): string | null {
  const text = normalizeText(value);

  const colon = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon?.[1] && colon[2]) {
    return buildTime(Number(colon[1]), Number(colon[2]));
  }

  const relative = text.match(
    /(?:a\s+las|desde\s+las|a\s+la)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/
  );
  if (relative?.[1]) {
    return buildTime(
      Number(relative[1]),
      relative[2] ? Number(relative[2]) : 0,
      relative[3]
    );
  }

  const meridiem = text.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (meridiem?.[1] && meridiem[2]) {
    return buildTime(Number(meridiem[1]), 0, meridiem[2]);
  }

  if (/\bmediodia\b/.test(text)) {
    return '12:00';
  }
  if (/\b(?:en|de|por)\s+la\s+manana\b/.test(text)) {
    return '09:00';
  }
  if (/\b(?:en|de|por)\s+la\s+tarde\b/.test(text)) {
    return '14:00';
  }
  if (/\b(?:en|de|por)\s+la\s+noche\b/.test(text)) {
    return '18:00';
  }

  return null;
}

export function extractDurationFromText(value: string): number | null {
  const text = normalizeText(value);

  const hoursAndHalf = text.match(/\b(\d+)\s+horas?\s+y\s+media\b/);
  if (hoursAndHalf?.[1]) {
    return Number(hoursAndHalf[1]) + 0.5;
  }

  if (/\bhora\s+y\s+media\b/.test(text)) {
    return 1.5;
  }

  const hours = text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:horas?|hrs?)\b/);
  if (hours?.[1]) {
    return Number(hours[1].replace(',', '.'));
  }

  const short = text.match(/\b(\d+(?:[.,]\d+)?)\s*h\b/);
  if (short?.[1]) {
    return Number(short[1].replace(',', '.'));
  }

  return null;
}

export function formatSpanishDate(date: string): string {
  const parsed = DateTime.fromISO(date, { zone: env.APP_TIME_ZONE });
  return parsed.isValid ? dateFormatter.format(parsed.toJSDate()) : date;
}
