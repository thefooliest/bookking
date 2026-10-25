import type { FastifyPluginAsync } from 'fastify';
import { quoteRequestSchema } from './schemas.js';
import { createQuote } from './service.js';

export const quoteRoutes: FastifyPluginAsync = async (app) => {
  app.post('/quotes', async (request) => {
    const input = quoteRequestSchema.parse(request.body);
    return createQuote(input);
  });
};
