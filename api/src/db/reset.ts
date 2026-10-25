import type { Pool } from 'pg';
import { pool } from './pool.js';

export async function resetDatabase(db: Pool = pool): Promise<void> {
  await db.query('DROP SCHEMA IF EXISTS public CASCADE');
  await db.query('CREATE SCHEMA public');
}
