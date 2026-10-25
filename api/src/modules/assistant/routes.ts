import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session.js';
import { assistantChatSchema } from './schemas.js';
import {
  getAssistantConversation,
  resetAssistantConversation,
  sendAssistantMessage
} from './service.js';

export const assistantRoutes: FastifyPluginAsync = async (app) => {
  app.get('/assistant', async (request) => {
    const session = requireSession(request, 'customer');
    return getAssistantConversation(session.userId);
  });

  app.post('/assistant/messages', async (request) => {
    const session = requireSession(request, 'customer');
    const { content } = assistantChatSchema.parse(request.body ?? {});
    return sendAssistantMessage(session.userId, content);
  });

  app.post('/assistant/reset', async (request, reply) => {
    const session = requireSession(request, 'customer');
    await resetAssistantConversation(session.userId);
    return reply.status(204).send();
  });
};
