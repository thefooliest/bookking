import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const defaultEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
loadDotenv({ path: process.env.ENV_FILE ?? defaultEnvPath });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://bookking:bookking@localhost:5433/bookking'),
  TEST_DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://bookking:bookking@localhost:5433/bookking_test'),
  SESSION_SECRET: z
    .string()
    .min(32)
    .default('dev-only-session-secret-please-change-me'),
  APP_TIME_ZONE: z.string().default('America/Bogota'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default('Bookking <reservas@bookking.local>')
});

export type Env = z.infer<typeof envSchema>;
export const env = envSchema.parse(process.env);
