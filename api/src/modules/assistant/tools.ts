import type { BookingDetail } from '@bookking/shared';
import { ZodError } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  createBooking,
  getBooking,
  updateBooking
} from '../bookings/service.js';
import { createQuote } from '../quotes/service.js';
import { listRooms } from '../rooms/repo.js';
import { formatSpanishDate, resolveDatePhrase } from './dates.js';
import {
  resolveDateToolSchema,
  saveDraftToolSchema
} from './schemas.js';
import { setConversationBooking } from './repo.js';
import { quoteRequestSchema } from '../quotes/schemas.js';

export type ToolContext = {
  conversationId: string;
  userId: number;
  bookingId: number | null;
};

type ToolSuccess = { ok: true; data: unknown };
type ToolFailure = { ok: false; error: string; details?: unknown };
export type ToolResult = ToolSuccess | ToolFailure;

function success(data: unknown): ToolSuccess {
  return { ok: true, data };
}

function failure(error: string, details?: unknown): ToolFailure {
  return { ok: false, error, details };
}

function toolBooking(booking: BookingDetail): Record<string, unknown> {
  return {
    id: booking.id,
    status: booking.status,
    customer: booking.draft.customer,
    room: booking.room,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    total: booking.total,
    quote: booking.quote,
    extras: booking.draft.extras,
    services: booking.services
  };
}

function parseArguments(raw: string): unknown {
  if (raw.trim() === '') {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

export async function executeTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext
): Promise<ToolResult> {
  let args: unknown;
  try {
    args = parseArguments(rawArguments);
  } catch {
    return failure('Los argumentos de la herramienta no son JSON válido.');
  }

  try {
    switch (name) {
      case 'list_rooms': {
        return success(await listRooms());
      }

      case 'resolve_date': {
        const input = resolveDateToolSchema.parse(args);
        const date = resolveDatePhrase(input.phrase);
        if (!date) {
          return failure(
            `No pude interpretar la fecha "${input.phrase}". Pide una fecha concreta o un día de la semana.`
          );
        }
        return success({ date, label: formatSpanishDate(date) });
      }

      case 'get_quote': {
        const input = quoteRequestSchema.parse(args);
        return success(await createQuote(input));
      }

      case 'save_booking_draft': {
        const input = saveDraftToolSchema.parse(args);
        const quote = await createQuote(input.schedule);
        if (!quote.available) {
          return failure(
            quote.reason ?? 'El horario seleccionado no está disponible.',
            quote
          );
        }

        let booking: BookingDetail;

        if (ctx.bookingId !== null) {
          const current = await getBooking(ctx.bookingId, ctx.userId, 'customer');
          if (current.status !== 'draft') {
            return failure(
              'La reserva ya no está en borrador y no se puede modificar desde el chat.'
            );
          }

          booking = await updateBooking(ctx.bookingId, ctx.userId, {
            customer: input.customer,
            schedule: input.schedule,
            extras: input.extras,
            notes: input.notes,
            currentStep: 3
          });
        } else {
          const created = await createBooking(ctx.userId, input.customer);
          booking = await updateBooking(created.id, ctx.userId, {
            customer: input.customer,
            schedule: input.schedule,
            extras: input.extras,
            notes: input.notes,
            currentStep: 3
          });
        }

        ctx.bookingId = booking.id;
        await setConversationBooking(ctx.conversationId, booking.id);
        return success(toolBooking(booking));
      }

      default:
        return failure(
          'Herramienta no permitida. Solo puedes consultar salas, resolver fechas, cotizar y guardar borradores.'
        );
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return failure('Los datos de la herramienta son inválidos.', error.issues);
    }
    if (error instanceof AppError) {
      return failure(error.message, error.details);
    }
    throw error;
  }
}

export const assistantTools = [
  {
    type: 'function',
    function: {
      name: 'list_rooms',
      description: 'Lista las salas disponibles con su id, nombre, tamaño y tarifa por hora.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resolve_date',
      description:
        'Convierte una fecha relativa en lenguaje natural (por ejemplo "el sábado" o "mañana") a una fecha ISO. Úsala siempre que el cliente mencione una fecha relativa.',
      parameters: {
        type: 'object',
        properties: {
          phrase: {
            type: 'string',
            description: 'Expresión de fecha del cliente, sin inventar el resultado.'
          }
        },
        required: ['phrase'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_quote',
      description:
        'Cotiza una sala y devuelve precio y disponibilidad reales. Nunca calcules precios o disponibilidad por tu cuenta.',
      parameters: {
        type: 'object',
        properties: {
          roomId: { type: 'integer', minimum: 1 },
          date: { type: 'string', description: 'Fecha ISO YYYY-MM-DD' },
          startTime: { type: 'string', description: 'Hora HH:mm en bloques de 30 minutos' },
          durationHours: {
            type: 'number',
            minimum: 1,
            maximum: 10,
            multipleOf: 0.5
          }
        },
        required: ['roomId', 'date', 'startTime', 'durationHours'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_booking_draft',
      description:
        'Crea o actualiza el borrador de reserva del cliente con todos los datos. Nunca confirma ni cancela. Solo úsala cuando tengas cliente, sala, fecha, hora, duración y una cotización disponible.',
      parameters: {
        type: 'object',
        properties: {
          customer: {
            type: 'object',
            properties: {
              fullName: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              company: { type: ['string', 'null'] }
            },
            required: ['fullName', 'email', 'phone'],
            additionalProperties: false
          },
          schedule: {
            type: 'object',
            properties: {
              roomId: { type: 'integer', minimum: 1 },
              date: { type: 'string' },
              startTime: { type: 'string' },
              durationHours: {
                type: 'number',
                minimum: 1,
                maximum: 10,
                multipleOf: 0.5
              }
            },
            required: ['roomId', 'date', 'startTime', 'durationHours'],
            additionalProperties: false
          },
          extras: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['projector', 'coffee'] },
                quantity: { type: 'integer', minimum: 1, maximum: 10 }
              },
              required: ['code', 'quantity'],
              additionalProperties: false
            }
          },
          notes: { type: ['string', 'null'] }
        },
        required: ['customer', 'schedule'],
        additionalProperties: false
      }
    }
  }
] as const;
