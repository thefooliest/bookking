import type { AuthResponse } from '@bookking/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { verifyPassword } from '../../lib/password.js';
import { findUserByEmail, findUserById } from './repo.js';
import { loginSchema } from './schemas.js';
import { clearSession, getSession, setSession } from './session.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await findUserByEmail(input.email);

    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new AppError(401, 'invalid_credentials', 'Correo o contraseña incorrectos.');
    }

    setSession(reply, user);

    const { passwordHash: _, ...authUser } = user;
    return reply.send({ user: authUser } satisfies AuthResponse);
  });

  app.post('/auth/logout', async (_request, reply) => {
    clearSession(reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', async (request, reply) => {
    const session = getSession(request);
    if (!session) {
      return reply.send({ user: null } satisfies AuthResponse);
    }

    const user = await findUserById(session.userId);
    if (!user) {
      clearSession(reply);
      return reply.send({ user: null } satisfies AuthResponse);
    }

    return reply.send({ user } satisfies AuthResponse);
  });
}
