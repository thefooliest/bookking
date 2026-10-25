import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './modules/auth/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { quoteRoutes } from './modules/quotes/routes.js';
import { roomRoutes } from './modules/rooms/routes.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' }
  });

  app.register(cookie, { secret: env.SESSION_SECRET });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Datos inválidos',
        details: error.issues
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: 'internal_error',
      message: 'Error interno del servidor'
    });
  });

  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });
  app.register(roomRoutes, { prefix: '/api' });
  app.register(quoteRoutes, { prefix: '/api' });

  return app;
}
