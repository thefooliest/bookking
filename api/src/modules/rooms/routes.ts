import type { FastifyPluginAsync } from 'fastify';
import { listRooms } from './repo.js';

export const roomRoutes: FastifyPluginAsync = async (app) => {
  app.get('/rooms', async () => listRooms());
};
