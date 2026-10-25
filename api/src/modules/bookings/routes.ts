import type { FastifyPluginAsync } from 'fastify';
import { requireSession } from '../auth/session.js';
import {
  bookingCancelSchema,
  bookingCreateSchema,
  bookingIdSchema,
  bookingListQuerySchema,
  bookingUpdateSchema
} from './schemas.js';
import {
  cancelBooking,
  completeBooking,
  confirmBooking,
  createBooking,
  getBooking,
  getBookings,
  updateBooking
} from './service.js';

export const bookingRoutes: FastifyPluginAsync = async (app) => {
  app.post('/bookings', async (request, reply) => {
    const session = requireSession(request, 'customer');
    const input = bookingCreateSchema.parse(request.body ?? {});
    const booking = await createBooking(session.userId, input.customer);
    return reply.status(201).send(booking);
  });

  app.get('/bookings', async (request) => {
    const session = requireSession(request);
    const query = bookingListQuerySchema.parse(request.query);

    return getBookings({
      userId: session.userId,
      role: session.role,
      query
    });
  });

  app.get('/bookings/:id', async (request) => {
    const session = requireSession(request);
    const { id } = bookingIdSchema.parse(request.params);
    return getBooking(id, session.userId, session.role);
  });

  app.patch('/bookings/:id', async (request) => {
    const session = requireSession(request, 'customer');
    const { id } = bookingIdSchema.parse(request.params);
    const input = bookingUpdateSchema.parse(request.body ?? {});
    return updateBooking(id, session.userId, input);
  });

  app.post('/bookings/:id/confirm', async (request) => {
    const session = requireSession(request, 'customer');
    const { id } = bookingIdSchema.parse(request.params);
    return confirmBooking(id, session.userId);
  });

  app.post('/bookings/:id/cancel', async (request) => {
    const session = requireSession(request, 'admin');
    const { id } = bookingIdSchema.parse(request.params);
    const { reason } = bookingCancelSchema.parse(request.body ?? {});
    return cancelBooking(id, session.userId, reason);
  });

  app.post('/bookings/:id/complete', async (request) => {
    const session = requireSession(request, 'admin');
    const { id } = bookingIdSchema.parse(request.params);
    return completeBooking(id, session.userId);
  });
};
