import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { healthRoutes } from './modules/health/routes.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' }
  });

  app.register(healthRoutes, { prefix: '/api' });

  return app;
}
