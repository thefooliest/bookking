import { APP_NAME } from '@bookking/shared';
import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    status: 'ok',
    app: APP_NAME,
    timestamp: new Date().toISOString()
  }));
};
