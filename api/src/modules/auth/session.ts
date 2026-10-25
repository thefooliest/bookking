import { USER_ROLES, type UserRole } from '@bookking/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

export const SESSION_COOKIE = 'bookking_session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const sessionSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(USER_ROLES)
});

export type Session = z.infer<typeof sessionSchema>;

export function setSession(
  reply: FastifyReply,
  user: { id: number; role: UserRole }
): void {
  const payload = Buffer.from(
    JSON.stringify({ userId: user.id, role: user.role }),
    'utf8'
  ).toString('base64url');

  reply.setCookie(SESSION_COOKIE, payload, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function getSession(request: FastifyRequest): Session | null {
  const signedValue = request.cookies[SESSION_COOKIE];
  if (!signedValue) {
    return null;
  }

  const unsigned = request.unsignCookie(signedValue);
  if (!unsigned.valid || !unsigned.value) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(
      Buffer.from(unsigned.value, 'base64url').toString('utf8')
    );
    const parsed = sessionSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function requireSession(
  request: FastifyRequest,
  role?: UserRole
): Session {
  const session = getSession(request);

  if (!session) {
    throw new AppError(401, 'unauthorized', 'Debes iniciar sesión.');
  }

  if (role && session.role !== role) {
    throw new AppError(403, 'forbidden', 'No tienes permisos para esta acción.');
  }

  return session;
}
