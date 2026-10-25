import {
  BOOKING_STATUSES,
  EXTRA_SERVICE_CODES
} from '@bookking/shared';
import { z } from 'zod';
import { quoteRequestSchema } from '../quotes/schemas.js';

const companySchema = z
  .string()
  .trim()
  .max(120, 'La empresa no puede superar los 120 caracteres.')
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

export const customerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres.')
    .max(120, 'El nombre no puede superar los 120 caracteres.'),
  email: z.string().trim().email('Ingresa un correo válido.'),
  phone: z
    .string()
    .trim()
    .min(7, 'El teléfono debe tener al menos 7 caracteres.')
    .max(20, 'El teléfono no puede superar los 20 caracteres.')
    .regex(/^[0-9+()\s-]+$/, 'El teléfono contiene caracteres inválidos.'),
  company: companySchema
});

export const bookingExtraSchema = z.object({
  code: z.enum(EXTRA_SERVICE_CODES),
  quantity: z.coerce
    .number()
    .int('La cantidad debe ser un entero.')
    .min(1, 'La cantidad mínima es 1.')
    .max(10, 'La cantidad máxima es 10.')
});

export const bookingExtrasSchema = z
  .array(bookingExtraSchema)
  .max(EXTRA_SERVICE_CODES.length)
  .superRefine((extras, context) => {
    const seen = new Set<string>();

    for (const [index, extra] of extras.entries()) {
      if (seen.has(extra.code)) {
        context.addIssue({
          code: 'custom',
          message: 'No puedes repetir un servicio adicional.',
          path: [index, 'code']
        });
      }
      seen.add(extra.code);
    }
  });

const notesSchema = z
  .string()
  .trim()
  .max(500, 'Las notas no pueden superar los 500 caracteres.')
  .nullable()
  .transform((value) => (value && value.length > 0 ? value : null));

export const bookingDraftSchema = z.object({
  customer: customerSchema.nullable().default(null),
  schedule: quoteRequestSchema.nullable().default(null),
  extras: bookingExtrasSchema.default([]),
  notes: notesSchema.default(null)
});

export const bookingCreateSchema = z.object({
  customer: customerSchema.optional()
});

export const bookingUpdateSchema = z
  .object({
    currentStep: z.coerce.number().int().min(1).max(3).optional(),
    customer: customerSchema.optional(),
    schedule: quoteRequestSchema.optional(),
    extras: bookingExtrasSchema.optional(),
    notes: notesSchema.optional()
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'No hay cambios para guardar.'
  );

export const bookingIdSchema = z.object({
  id: z.coerce.number().int().positive()
});

const emptyToUndefined = (value: unknown) =>
  value === '' || value === undefined ? undefined : value;

export const bookingListQuerySchema = z.object({
  status: z.preprocess(
    emptyToUndefined,
    z.enum(BOOKING_STATUSES).optional()
  ),
  roomId: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional()
  ),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(1)),
  pageSize: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(50).default(10)
  )
});

export const bookingCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'El motivo debe tener al menos 5 caracteres.')
    .max(500, 'El motivo no puede superar los 500 caracteres.')
});

export type BookingUpdateInput = z.infer<typeof bookingUpdateSchema>;
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
