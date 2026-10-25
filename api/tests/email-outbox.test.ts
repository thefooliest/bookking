import type { BookingDetail, BookingListResponse, Room } from '@bookking/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { closePool, pool } from '../src/db/pool.js';
import { resetDatabase } from '../src/db/reset.js';
import { seed } from '../src/db/seed.js';
import type { EmailMessage } from '../src/modules/email/transport.js';
import { processEmailOutboxOnce } from '../src/modules/email/worker.js';

const app = buildApp();

let customerCookie = '';
let adminCookie = '';
let smallRoomId = 0;

const customerData = {
  fullName: 'Cliente Demo',
  email: 'cliente@bookking.local',
  phone: '+57 300 123 4567',
  company: 'Acme'
};

type OutboxRow = {
  id: string;
  booking_id: number;
  status: string;
  attempts: number;
  recipient: string;
  subject: string;
  body_text: string;
  message_id: string;
  last_error: string | null;
};

beforeAll(async () => {
  await resetDatabase();
  await migrate();
  await seed();

  customerCookie = await login('cliente@bookking.local', 'cliente123');
  adminCookie = await login('admin@bookking.local', 'admin123');

  const rooms = await app.inject({ method: 'GET', url: '/api/rooms' });
  smallRoomId = rooms.json<Room[]>()[0]?.id ?? 0;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function login(email: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password }
  });
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(';')[0];
  if (!cookie) {
    throw new Error('Login did not return a session cookie');
  }
  return cookie;
}

async function fillBooking(date: string, startTime: string): Promise<number> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    headers: { cookie: customerCookie }
  });
  const id = created.json<BookingDetail>().id;

  const customerStep = await app.inject({
    method: 'PATCH',
    url: `/api/bookings/${id}`,
    headers: { cookie: customerCookie },
    payload: { customer: customerData, currentStep: 2 }
  });
  expect(customerStep.statusCode).toBe(200);

  const scheduleStep = await app.inject({
    method: 'PATCH',
    url: `/api/bookings/${id}`,
    headers: { cookie: customerCookie },
    payload: {
      currentStep: 3,
      schedule: {
        roomId: smallRoomId,
        date,
        startTime,
        durationHours: 2
      }
    }
  });
  expect(scheduleStep.statusCode).toBe(200);

  const extrasStep = await app.inject({
    method: 'PATCH',
    url: `/api/bookings/${id}`,
    headers: { cookie: customerCookie },
    payload: {
      currentStep: 3,
      extras: [{ code: 'projector', quantity: 1 }]
    }
  });
  expect(extrasStep.statusCode).toBe(200);

  return id;
}

async function getOutbox(bookingId: number): Promise<OutboxRow[]> {
  const result = await pool.query<OutboxRow>(
    'SELECT * FROM email_outbox WHERE booking_id = $1',
    [bookingId]
  );
  return result.rows;
}

describe('confirmation email outbox', () => {
  it('enqueues exactly one email when the same booking is confirmed twice', async () => {
    const id = await fillBooking('2026-11-03', '09:00');

    const confirmations = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/bookings/${id}/confirm`,
        headers: { cookie: customerCookie }
      }),
      app.inject({
        method: 'POST',
        url: `/api/bookings/${id}/confirm`,
        headers: { cookie: customerCookie }
      })
    ]);

    expect(confirmations.map((response) => response.statusCode)).toEqual([200, 200]);

    const outbox = await getOutbox(id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      booking_id: id,
      status: 'pending',
      attempts: 0,
      recipient: 'cliente@bookking.local',
      subject: expect.stringContaining(`#${id}`),
      message_id: `<booking-${id}-confirmation@bookking.local>`
    });
    expect(outbox[0]?.body_text).toContain('Sala Pequeña');
    expect(outbox[0]?.body_text).toContain('Tu reserva en Bookking quedó confirmada');

    const repeated = await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/confirm`,
      headers: { cookie: customerCookie }
    });
    expect(repeated.statusCode).toBe(200);
    expect(await getOutbox(id)).toHaveLength(1);

    await pool.query(
      `UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE booking_id = $1`,
      [id]
    );
  });

  it('sends a pending email in the background worker and exposes the status to admins', async () => {
    const id = await fillBooking('2026-11-04', '09:00');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/bookings/${id}/confirm`,
          headers: { cookie: customerCookie }
        })
      ).statusCode
    ).toBe(200);

    const sent: EmailMessage[] = [];
    const processed = await processEmailOutboxOnce(async (message) => {
      sent.push(message);
    });

    expect(processed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'cliente@bookking.local',
      messageId: `<booking-${id}-confirmation@bookking.local>`
    });

    const outbox = await getOutbox(id);
    expect(outbox[0]).toMatchObject({ status: 'sent', attempts: 1, last_error: null });

    const adminDetail = await app.inject({
      method: 'GET',
      url: `/api/bookings/${id}`,
      headers: { cookie: adminCookie }
    });
    expect(adminDetail.statusCode).toBe(200);
    expect(adminDetail.json<BookingDetail>().email).toMatchObject({
      status: 'sent',
      attempts: 1,
      recipient: 'cliente@bookking.local'
    });
  });

  it('retries with backoff and marks the email as failed after five attempts', async () => {
    const id = await fillBooking('2026-11-05', '09:00');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/bookings/${id}/confirm`,
          headers: { cookie: customerCookie }
        })
      ).statusCode
    ).toBe(200);

    await pool.query(
      `UPDATE email_outbox
       SET attempts = 4, next_attempt_at = now() - interval '1 minute'
       WHERE booking_id = $1`,
      [id]
    );

    const processed = await processEmailOutboxOnce(async () => {
      throw new Error('SMTP no disponible');
    });
    expect(processed).toBe(1);

    const outbox = await getOutbox(id);
    expect(outbox[0]).toMatchObject({
      status: 'failed',
      attempts: 5,
      last_error: 'SMTP no disponible'
    });

    const adminDetail = await app.inject({
      method: 'GET',
      url: `/api/bookings/${id}`,
      headers: { cookie: adminCookie }
    });
    expect(adminDetail.json<BookingDetail>().email).toMatchObject({
      status: 'failed',
      attempts: 5,
      lastError: 'SMTP no disponible'
    });
  });

  it('keeps a failed email failed when the booking is confirmed again', async () => {
    const id = await fillBooking('2026-11-12', '09:00');
    await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/confirm`,
      headers: { cookie: customerCookie }
    });

    await pool.query(
      `UPDATE email_outbox
       SET status = 'failed', attempts = 5, last_error = 'fallo previo'
       WHERE booking_id = $1`,
      [id]
    );

    await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/confirm`,
      headers: { cookie: customerCookie }
    });

    const outbox = await getOutbox(id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      status: 'failed',
      attempts: 5,
      last_error: 'fallo previo'
    });
  });

  it('includes a pending email in the admin booking list detail', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/bookings?status=confirmed&pageSize=50',
      headers: { cookie: adminCookie }
    });
    const first = list.json<BookingListResponse>().items[0];
    expect(first).toBeDefined();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/bookings/${first?.id}`,
      headers: { cookie: adminCookie }
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<BookingDetail>().email?.recipient).toBeDefined();
  });
});
