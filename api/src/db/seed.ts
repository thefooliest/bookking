import type { RoomSize, UserRole } from '@bookking/shared';
import type { Pool } from 'pg';
import { hashPassword } from '../lib/password.js';
import { pool } from './pool.js';

type DemoUser = {
  email: string;
  fullName: string;
  role: UserRole;
  password: string;
};

type DemoRoom = {
  name: string;
  size: RoomSize;
  hourlyRate: number;
};

export const demoUsers: DemoUser[] = [
  {
    email: 'cliente@bookking.local',
    fullName: 'Cliente Demo',
    role: 'customer',
    password: 'cliente123'
  },
  {
    email: 'admin@bookking.local',
    fullName: 'Administrador Demo',
    role: 'admin',
    password: 'admin123'
  }
];

export const demoRooms: DemoRoom[] = [
  { name: 'Sala Pequeña', size: 'small', hourlyRate: 40000 },
  { name: 'Sala Mediana', size: 'medium', hourlyRate: 70000 },
  { name: 'Sala Grande', size: 'large', hourlyRate: 120000 }
];

export async function seed(db: Pool = pool): Promise<void> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    for (const user of demoUsers) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [user.email, hashPassword(user.password), user.fullName, user.role]
      );
    }

    for (const room of demoRooms) {
      await client.query(
        `INSERT INTO rooms (name, size, hourly_rate)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING`,
        [room.name, room.size, room.hourlyRate]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
