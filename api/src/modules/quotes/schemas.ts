import { z } from 'zod';

const startTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener formato HH:mm')
  .refine((value) => {
    const minutes = value.slice(3);
    return Number(minutes) % 30 === 0;
  }, 'La hora debe estar en bloques de 30 minutos');

export const quoteRequestSchema = z.object({
  roomId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD'),
  startTime: startTimeSchema,
  durationHours: z.coerce
    .number()
    .min(1, 'La duración mínima es de 1 hora')
    .max(10, 'La duración máxima es de 10 horas')
    .multipleOf(0.5, 'La duración debe ir en bloques de 30 minutos')
});

export type QuoteRequestInput = z.infer<typeof quoteRequestSchema>;
