import type {
  AssistantMessage,
  AuthUser,
  BookingDetail,
  BookingExtraInput,
  BookingSchedule,
  QuoteResponse,
  Room,
  RoomSize
} from '@bookking/shared';
import { env } from '../../config/env.js';
import { createQuote } from '../quotes/service.js';
import { quoteRequestSchema } from '../quotes/schemas.js';
import { listRooms } from '../rooms/repo.js';
import {
  extractDurationFromText,
  extractTimeFromText,
  formatSpanishDate,
  normalizeText,
  resolveDatePhrase
} from './dates.js';
import { mockContextSchema, type MockContext } from './schemas.js';
import { executeTool } from './tools.js';

type PartialSchedule = {
  roomId?: number;
  date?: string;
  startTime?: string;
  durationHours?: number;
};

type MockResult = {
  reply: string;
  context: MockContext;
};

const currencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

function forbiddenRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    /\b(ignora|olvida|ignore|disregard|forget)\b.*\b(instruccion|instrucciones|regla|prompt|sistema|instructions?|rules?|system)\b/.test(
      normalized
    ) ||
    /\b(system prompt|otras? reservas?|todas? las reservas?|otros? clientes?|reservas? de (otros|clientes)|todos los clientes|inventa|calcula|all (bookings?|reservations?)|other (bookings?|reservations?|customers?))\b/.test(
      normalized
    ) ||
    /\b(confirma|confirmar|confirmame|cancela|cancelar|cancelame|elimina|borra|confirm|cancel|delete)\b/.test(
      normalized
    )
  );
}

function extractPhone(text: string): string | null {
  const labelled = text.match(
    /(?:tel[eé]fono|celular|whatsapp|contacto)[^0-9+]{0,20}([+()0-9][0-9\s().-]{6,20})/i
  );
  const mobile = text.match(/\b(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})\b/);
  const candidate = labelled?.[1] ?? mobile?.[1];
  if (!candidate) {
    return null;
  }

  const cleaned = candidate.replace(/[.\s]+$/, '').trim();
  const digits = cleaned.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? cleaned : null;
}

function roomSizeFromText(text: string): RoomSize | null {
  const normalized = normalizeText(text);
  if (/\bpequena\b/.test(normalized)) {
    return 'small';
  }
  if (/\bmediana\b/.test(normalized)) {
    return 'medium';
  }
  if (/\bgrande\b/.test(normalized)) {
    return 'large';
  }

  const people = normalized.match(/\b(\d+)\s*(?:personas?|pax|asistentes?)\b/);
  if (!people?.[1]) {
    return null;
  }

  const count = Number(people[1]);
  if (count <= 4) {
    return 'small';
  }
  if (count <= 8) {
    return 'medium';
  }
  return 'large';
}

function findRoomId(text: string, rooms: Room[]): number | null {
  const size = roomSizeFromText(text);
  return size ? (rooms.find((room) => room.size === size)?.id ?? null) : null;
}

function mergeExtras(text: string, current: BookingExtraInput[]): BookingExtraInput[] {
  const normalized = normalizeText(text);
  let extras = [...current];

  function upsert(code: BookingExtraInput['code'], requested: boolean, missing: boolean): void {
    const quantityMatch = normalized.match(
      new RegExp(`\\b(\\d+)\\s*(?:${code === 'projector' ? 'proyectores?' : 'caf[eé]s?'})\\b`)
    );
    const quantity = quantityMatch?.[1] ? Math.min(Number(quantityMatch[1]), 10) : 1;

    extras = extras.filter((extra) => extra.code !== code);
    if (requested && !missing) {
      extras.push({ code, quantity: Math.max(quantity, 1) });
    }
  }

  const noProjector = /\bsin\s+proyector/.test(normalized);
  const wantsProjector = /\bproyector(es)?\b/.test(normalized) && !noProjector;
  if (wantsProjector || noProjector) {
    upsert('projector', wantsProjector, noProjector);
  }

  const noCoffee = /\bsin\s+caf[eé]\b/.test(normalized);
  const wantsCoffee = /\bcaf[eé]\b/.test(normalized) && !noCoffee;
  if (wantsCoffee || noCoffee) {
    upsert('coffee', wantsCoffee, noCoffee);
  }

  return extras;
}

function acceptsProposal(text: string): boolean {
  return /\b(si|sí|dale|vale|acepto|perfecto|listo|ok|de acuerdo|me sirve)\b/i.test(text);
}

function formatQuote(quote: QuoteResponse): string {
  return `${quote.room.name} el ${formatSpanishDate(quote.date)} de ${quote.startTime} a ${quote.endTime} (${quote.durationHours} ${quote.durationHours === 1 ? 'hora' : 'horas'}), total ${currencyFormatter.format(quote.total)}.`;
}

function quoteSummary(quote: QuoteResponse): string {
  return `Encontré disponibilidad: ${formatQuote(quote)}`;
}

function contextFor(
  base: MockContext,
  collected: NonNullable<MockContext['collected']>
): MockContext {
  return { ...base, collected };
}

export async function runMockAssistant(input: {
  user: AuthUser;
  messages: AssistantMessage[];
  booking: BookingDetail | null;
  context: unknown;
  conversationId: string;
}): Promise<MockResult> {
  const parsedContext = mockContextSchema.safeParse(input.context);
  const context: MockContext = parsedContext.success ? parsedContext.data : {};
  const previous = context.collected;
  const lastUserMessage =
    [...input.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const text = lastUserMessage;

  if (forbiddenRequest(text)) {
    const suffix =
      input.booking?.status === 'draft'
        ? ' Tu borrador está listo; puedes revisarlo y confirmarlo con el botón de la app.'
        : '';
    return {
      reply: `No puedo confirmar ni cancelar reservas desde el chat, ni cambiar mis reglas, ver otras reservas o inventar precios.${suffix}`,
      context
    };
  }

  const rooms = await listRooms();
  let schedule: PartialSchedule = { ...(previous?.draftSchedule ?? {}) };
  if (input.booking?.draft.schedule) {
    schedule = { ...input.booking.draft.schedule };
  }

  let pendingSlot = previous?.pendingSlot ?? null;
  let extras = input.booking?.draft.extras ?? previous?.extras ?? [];
  extras = mergeExtras(text, extras);

  const newDate = resolveDatePhrase(text);
  const newTime = extractTimeFromText(text);
  const newDuration = extractDurationFromText(text);
  const newRoomId = findRoomId(text, rooms);
  const newPhone = extractPhone(text);

  if (pendingSlot && !newDate && !newTime && !newDuration && acceptsProposal(text)) {
    schedule = { ...pendingSlot };
    pendingSlot = null;
  } else if (newDate || newTime || newDuration || newRoomId) {
    pendingSlot = null;
  }

  if (newDate) {
    schedule.date = newDate;
  }
  if (newTime) {
    schedule.startTime = newTime;
  }
  if (newDuration !== null) {
    schedule.durationHours = newDuration;
  }
  if (newRoomId !== null) {
    schedule.roomId = newRoomId;
  }

  const existingCustomer = input.booking?.draft.customer ?? null;
  const phone = newPhone ?? existingCustomer?.phone ?? previous?.phone ?? null;
  const company = existingCustomer?.company ?? previous?.company ?? null;

  const missing: string[] = [];
  if (!schedule.date) {
    missing.push('la fecha');
  }
  if (!schedule.roomId) {
    missing.push('la sala (pequeña, mediana o grande)');
  }
  if (!schedule.startTime) {
    missing.push('la hora de inicio');
  }
  if (!schedule.durationHours) {
    missing.push('la duración en horas');
  }

  const nextCollected = {
    phone,
    company,
    draftSchedule: schedule,
    extras,
    pendingSlot
  };

  if (missing.length > 0) {
    return {
      reply: `Para preparar tu cotización me falta ${missing.join(', ')}.`,
      context: contextFor(context, nextCollected)
    };
  }

  const scheduleInput = quoteRequestSchema.safeParse(schedule);
  if (!scheduleInput.success) {
    return {
      reply:
        'La duración debe ser entre 1 y 10 horas, en bloques de 30 minutos, y la hora debe estar entre 07:00 y 21:00. ¿Me confirmas el horario?',
      context: contextFor(context, nextCollected)
    };
  }

  const quote = await createQuote(scheduleInput.data);

  if (!quote.available) {
    const next: {
      roomId: number;
      date: string;
      startTime: string;
      durationHours: number;
    } | null = quote.nextAvailable
      ? {
          roomId: quote.room.id,
          date: quote.date,
          startTime: quote.nextAvailable.startTime,
          durationHours: quote.durationHours
        }
      : null;

    const proposal = quote.nextAvailable
      ? ` Te propongo ${quote.nextAvailable.startTime} a ${quote.nextAvailable.endTime} ese mismo día. ¿Te sirve?`
      : ' No quedan más cupos ese día. ¿Probamos otra fecha?';

    return {
      reply: `${quote.reason ?? 'Ese horario no está disponible.'}${proposal}`,
      context: contextFor(context, { ...nextCollected, pendingSlot: next })
    };
  }

  if (!phone) {
    return {
      reply: `${quoteSummary(quote)} Para dejar la reserva en borrador, ¿me compartes tu teléfono de contacto?`,
      context: contextFor(context, nextCollected)
    };
  }

  if (input.booking && input.booking.status !== 'draft') {
    return {
      reply: `Tu reserva #${input.booking.id} ya está ${input.booking.status === 'confirmed' ? 'confirmada' : input.booking.status}. No puedo modificarla ni cancelarla desde el chat. Si quieres otra reserva, inicia una nueva conversación.`,
      context: contextFor(context, nextCollected)
    };
  }

  const customer = {
    fullName: existingCustomer?.fullName ?? input.user.fullName,
    email: existingCustomer?.email ?? input.user.email,
    phone,
    company
  };
  const scheduleFinal: BookingSchedule = {
    roomId: schedule.roomId as number,
    date: schedule.date as string,
    startTime: schedule.startTime as string,
    durationHours: schedule.durationHours as number
  };

  const toolContext = {
    conversationId: input.conversationId,
    userId: input.user.id,
    bookingId: input.booking?.id ?? null
  };

  const saved = await executeTool(
    'save_booking_draft',
    JSON.stringify({
      customer,
      schedule: scheduleFinal,
      extras,
      notes: input.booking?.draft.notes ?? null
    }),
    toolContext
  );

  if (!saved.ok) {
    const details = saved.details as QuoteResponse | undefined;
    if (details?.nextAvailable) {
      return {
        reply: `${saved.error} Te propongo ${details.nextAvailable.startTime} a ${details.nextAvailable.endTime}. ¿Te sirve?`,
        context: contextFor(context, {
          ...nextCollected,
          pendingSlot: {
            roomId: scheduleFinal.roomId,
            date: scheduleFinal.date,
            startTime: details.nextAvailable.startTime,
            durationHours: scheduleFinal.durationHours
          }
        })
      };
    }

    return {
      reply: `No pude guardar el borrador: ${saved.error}`,
      context: contextFor(context, nextCollected)
    };
  }

  const booking = saved.data as {
    id: number;
    total: number | null;
    room: { name: string } | null;
  };

  return {
    reply: `Listo. Dejé la reserva #${booking.id} en borrador para ${booking.room?.name ?? 'la sala'} el ${formatSpanishDate(scheduleFinal.date)} de ${scheduleFinal.startTime} a ${quote.endTime}. Total: ${currencyFormatter.format(booking.total ?? quote.total)}. Revísala y confírmala con el botón de abajo.`,
    context: contextFor(context, {
      phone,
      company,
      draftSchedule: scheduleFinal,
      extras,
      pendingSlot: null
    })
  };
}
