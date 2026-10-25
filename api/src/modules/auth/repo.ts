import type { AuthUser, UserRole } from '@bookking/shared';
import { pool } from '../../db/pool.js';

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
};

export type UserWithPassword = AuthUser & {
  passwordHash: string;
};

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role
  };
}

export async function findUserByEmail(email: string): Promise<UserWithPassword | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, email, password_hash, full_name, role
     FROM users
     WHERE lower(email) = lower($1)`,
    [email]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return { ...toAuthUser(row), passwordHash: row.password_hash };
}

export async function findUserById(id: number): Promise<AuthUser | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, email, password_hash, full_name, role
     FROM users
     WHERE id = $1`,
    [id]
  );

  const row = result.rows[0];
  return row ? toAuthUser(row) : null;
}
