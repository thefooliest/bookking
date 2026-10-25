import { z } from 'zod';
import {
  bookingExtrasSchema,
  customerSchema
} from '../bookings/schemas.js';
import { quoteRequestSchema } from '../quotes/schemas.js';

export const assistantChatSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Escribe un mensaje.')
    .max(1000, 'El mensaje no puede superar los 1000 caracteres.')
});

const assistantNotesSchema = z
  .string()
  .trim()
  .max(500, 'Las notas no pueden superar los 500 caracteres.')
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

export const resolveDateToolSchema = z.object({
  phrase: z.string().trim().min(1)
});

export const saveDraftToolSchema = z.object({
  customer: customerSchema,
  schedule: quoteRequestSchema,
  extras: bookingExtrasSchema.default([]),
  notes: assistantNotesSchema.default(null)
});

export const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string()
  })
});

export const providerMessageSchema = z.object({
  role: z.enum(['assistant']),
  content: z.string().nullable().optional(),
  tool_calls: z.array(toolCallSchema).optional()
});

export const assistantReplySchema = z
  .string()
  .trim()
  .min(1, 'El asistente no generó una respuesta.')
  .max(4000, 'La respuesta del asistente es demasiado larga.');

const mockPendingSlotSchema = z.object({
  date: z.string(),
  startTime: z.string(),
  durationHours: z.number(),
  roomId: z.number()
});

const partialScheduleSchema = z.object({
  roomId: z.number().int().positive().optional(),
  date: z.string().optional(),
  startTime: z.string().optional(),
  durationHours: z.number().optional()
});

export const mockContextSchema = z.object({
  collected: z
    .object({
      phone: z.string().nullish(),
      company: z.string().nullish(),
      draftSchedule: partialScheduleSchema.nullish(),
      extras: bookingExtrasSchema.optional(),
      pendingSlot: mockPendingSlotSchema.nullish()
    })
    .optional()
});

export type MockContext = z.infer<typeof mockContextSchema>;
export type AssistantChatInput = z.infer<typeof assistantChatSchema>;
