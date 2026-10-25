import type { AuthResponse, AuthUser } from '@bookking/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { resetDatabase } from '../src/db/reset.js';
import { seed } from '../src/db/seed.js';

const app = buildApp();

beforeAll(async () => {
  await resetDatabase();
  await migrate();
  await seed();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function login(email: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password }
  });

  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(';')[0];

  return { response, cookie, setCookie: cookieHeader };
}

async function getMe(cookie?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: cookie ? { cookie } : undefined
  });
}

describe('POST /api/auth/login', () => {
  it('logs in a customer and sets an httpOnly session cookie', async () => {
    const { response, cookie, setCookie } = await login(
      'cliente@bookking.local',
      'cliente123'
    );

    expect(response.statusCode).toBe(200);
    expect(response.json<AuthResponse>()).toEqual({
      user: {
        id: expect.any(Number),
        email: 'cliente@bookking.local',
        fullName: 'Cliente Demo',
        role: 'customer'
      }
    });
    expect(cookie).toMatch(/^bookking_session=/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('password');
  });

  it('logs in an admin', async () => {
    const { response } = await login('admin@bookking.local', 'admin123');

    expect(response.statusCode).toBe(200);
    expect(response.json<{ user: AuthUser }>().user.role).toBe('admin');
  });

  it('accepts email case-insensitively', async () => {
    const { response } = await login('CLIENTE@BOOKKING.LOCAL', 'cliente123');

    expect(response.statusCode).toBe(200);
  });

  it('rejects a wrong password without revealing which field failed', async () => {
    const { response } = await login('cliente@bookking.local', 'incorrecta');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'invalid_credentials',
      message: 'Correo o contraseña incorrectos.'
    });
  });

  it('rejects an unknown user', async () => {
    const { response } = await login('nadie@bookking.local', 'cualquiera');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'invalid_credentials' });
  });

  it('validates the request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'no-es-correo', password: '' }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_error' });
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated user', async () => {
    const { cookie } = await login('cliente@bookking.local', 'cliente123');
    const response = await getMe(cookie);

    expect(response.statusCode).toBe(200);
    expect(response.json<AuthResponse>()).toMatchObject({
      user: {
        email: 'cliente@bookking.local',
        fullName: 'Cliente Demo',
        role: 'customer'
      }
    });
  });

  it('returns null without a session', async () => {
    const response = await getMe();

    expect(response.statusCode).toBe(200);
    expect(response.json<AuthResponse>()).toEqual({ user: null });
  });

  it('ignores a tampered session cookie', async () => {
    const response = await getMe('bookking_session=eyJ1c2VySWQiOjEsInJvbGUiOiJhZG1pbiJ9.firma-falsa');

    expect(response.statusCode).toBe(200);
    expect(response.json<AuthResponse>()).toEqual({ user: null });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const { cookie } = await login('cliente@bookking.local', 'cliente123');
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: cookie ? { cookie } : undefined
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain('bookking_session=;');
  });
});
