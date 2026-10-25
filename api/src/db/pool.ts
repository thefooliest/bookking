import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
