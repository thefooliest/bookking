import type {
  AuthResponse,
  BookingDetail,
  BookingExtraInput,
  BookingListResponse,
  Room,
  RoomSize
} from '@bookking/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { resetDatabase } from '../src/db/reset.js';
import { seed } from '../src/db/seed.js';

const app = buildApp();

let customerCookie = '';
let adminCookie = '';
let customerId = 0;
let rooms: Room[] = [];

const customerData = {
  fullName: 'Cliente Demo',
  email: 'cliente@bookking.local',
  phone: '+57 300 123 4567',
  company: 'Acme'
};

beforeAll(async () => {
  await resetDatabase();
  await migrate();
  await seed();

  customerCookie = await login('cliente@bookking.local', 'cliente123');
  adminCookie = await login('admin@bookking.local', 'admin123');

  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: customerCookie }
  });
  customerId = me.json<AuthResponse>().user?.id ?? 0;

  const roomsResponse = await app.inject({ method: 'GET', url: '/api/rooms' });
  rooms = roomsResponse.json<Room[]>();
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
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(';')[0];
  if (!cookie) {
    throw new Error('Login did not return a session cookie');
  }
  return cookie;
}

function roomBySize(size: RoomSize): Room {
  const room = rooms.find((candidate) => candidate.size === size);
  if (!room) {
    throw new Error(`Room ${size} not found`);
  }
  return room;
}

async function createDraft(): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    headers: { cookie: customerCookie }
  });
  expect(response.statusCode).toBe(201);
  return response.json<BookingDetail>().id;
}

async function patchBooking(
  id: number,
  payload: Record<string, unknown>,
  cookie = customerCookie
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/bookings/${id}`,
    headers: { cookie },
    payload
  });
}

async function confirmBooking(id: number, cookie = customerCookie) {
  return app.inject({
    method: 'POST',
    url: `/api/bookings/${id}/confirm`,
    headers: { cookie }
  });
}

async function cancelBooking(id: number, reason: string, cookie = adminCookie) {
  return app.inject({
    method: 'POST',
    url: `/api/bookings/${id}/cancel`,
    headers: { cookie },
    payload: { reason }
  });
}

async function getBooking(id: number, cookie = customerCookie) {
  return app.inject({
    method: 'GET',
    url: `/api/bookings/${id}`,
    headers: { cookie }
  });
}

async function fillBooking(input: {
  size: RoomSize;
  date: string;
  startTime: string;
  durationHours: number;
  extras?: BookingExtraInput[];
}): Promise<number> {
  const room = roomBySize(input.size);
  const id = await createDraft();

  const customerStep = await patchBooking(id, {
    customer: customerData,
    currentStep: 2
  });
  expect(customerStep.statusCode).toBe(200);

  const scheduleStep = await patchBooking(id, {
    currentStep: 2,
    schedule: {
      roomId: room.id,
      date: input.date,
      startTime: input.startTime,
      durationHours: input.durationHours
    }
  });
  expect(scheduleStep.statusCode).toBe(200);

  const extrasStep = await patchBooking(id, {
    currentStep: 3,
    extras: input.extras ?? []
  });
  expect(extrasStep.statusCode).toBe(200);

  return id;
}

describe('booking authentication and validation', () => {
  it('requires a session to create a booking', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings'
    });

    expect(response.statusCode).toBe(401);
  });

  it('only allows customers to create bookings', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers: { cookie: adminCookie }
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects skipping the customer step', async () => {
    const id = await createDraft();
    const response = await patchBooking(id, { currentStep: 2 });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'incomplete_step' });
  });

  it('rejects advancing to extras without a schedule', async () => {
    const id = await createDraft();
    const response = await patchBooking(id, {
      customer: customerData,
      currentStep: 3
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'incomplete_step' });
  });

  it('validates extra service codes and duplicates', async () => {
    const id = await createDraft();
    await patchBooking(id, { customer: customerData, currentStep: 2 });

    const invalid = await patchBooking(id, {
      currentStep: 3,
      extras: [{ code: 'wifi', quantity: 1 }]
    });
    expect(invalid.statusCode).toBe(400);

    const duplicate = await patchBooking(id, {
      currentStep: 3,
      extras: [
        { code: 'projector', quantity: 1 },
        { code: 'projector', quantity: 2 }
      ]
    });
    expect(duplicate.statusCode).toBe(400);
  });
});

describe('booking draft and confirmation', () => {
  it('saves all three steps, totals extra services and confirms idempotently', async () => {
    const id = await fillBooking({
      size: 'small',
      date: '2026-11-03',
      startTime: '09:00',
      durationHours: 2,
      extras: [
        { code: 'projector', quantity: 1 },
        { code: 'coffee', quantity: 2 }
      ]
    });

    const draft = await getBooking(id);
    expect(draft.statusCode).toBe(200);
    expect(draft.json<BookingDetail>()).toMatchObject({
      id,
      status: 'draft',
      currentStep: 3,
      total: 135000,
      quote: {
        base: 80000,
        discount: 0,
        surcharge: 0,
        total: 80000
      },
      servicesTotal: 55000,
      draft: {
        customer: customerData,
        schedule: {
          date: '2026-11-03',
          startTime: '09:00',
          durationHours: 2
        }
      }
    });

    const confirmed = await confirmBooking(id);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<BookingDetail>()).toMatchObject({
      status: 'confirmed',
      total: 135000,
      quote: { total: 80000 },
      servicesTotal: 55000
    });
    expect(confirmed.json<BookingDetail>().confirmedAt).not.toBeNull();

    const repeated = await confirmBooking(id);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json<BookingDetail>()).toMatchObject({
      id,
      status: 'confirmed',
      total: 135000
    });
  });

  it('does not allow editing a confirmed booking', async () => {
    const id = await fillBooking({
      size: 'medium',
      date: '2026-11-10',
      startTime: '09:00',
      durationHours: 1
    });
    expect((await confirmBooking(id)).statusCode).toBe(200);

    const response = await patchBooking(id, { notes: 'Cambio tardío' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'booking_not_editable' });
  });

  it('returns the reason and next available slot when a schedule is taken', async () => {
    const first = await fillBooking({
      size: 'small',
      date: '2026-11-04',
      startTime: '10:00',
      durationHours: 1
    });
    expect((await confirmBooking(first)).statusCode).toBe(200);

    const second = await createDraft();
    await patchBooking(second, { customer: customerData, currentStep: 2 });
    const response = await patchBooking(second, {
      currentStep: 2,
      schedule: {
        roomId: roomBySize('small').id,
        date: '2026-11-04',
        startTime: '10:30',
        durationHours: 1
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: 'slot_unavailable',
      details: {
        available: false,
        reason: 'La sala ya está reservada en ese horario.',
        nextAvailable: { startTime: '11:00', endTime: '12:00' }
      }
    });
  });

  it('only lets one of two concurrent confirmations win the same slot', async () => {
    const first = await fillBooking({
      size: 'medium',
      date: '2026-11-05',
      startTime: '10:00',
      durationHours: 1
    });
    const second = await fillBooking({
      size: 'medium',
      date: '2026-11-05',
      startTime: '10:00',
      durationHours: 1
    });

    const results = await Promise.all([confirmBooking(first), confirmBooking(second)]);
    const statuses = results.map((result) => result.statusCode).sort();

    expect(statuses).toEqual([200, 409]);
    const rejected = results.find((result) => result.statusCode === 409);
    expect(rejected?.json()).toMatchObject({ error: 'slot_taken' });
  });

  it('returns the same booking when two confirmations race on the same draft', async () => {
    const id = await fillBooking({
      size: 'large',
      date: '2026-11-06',
      startTime: '10:00',
      durationHours: 1
    });

    const results = await Promise.all([confirmBooking(id), confirmBooking(id)]);
    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(results[0]?.json<BookingDetail>().id).toBe(id);
    expect(results[1]?.json<BookingDetail>().id).toBe(id);
    expect(results[0]?.json<BookingDetail>().total).toBe(120000);
    expect(results[1]?.json<BookingDetail>().total).toBe(120000);
  });
});

describe('booking state transitions', () => {
  it('validates admin completion and cancellation', async () => {
    const id = await fillBooking({
      size: 'small',
      date: '2026-11-09',
      startTime: '09:00',
      durationHours: 1
    });

    const completeDraft = await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/complete`,
      headers: { cookie: adminCookie }
    });
    expect(completeDraft.statusCode).toBe(409);
    expect(completeDraft.json()).toMatchObject({ error: 'invalid_transition' });

    expect((await confirmBooking(id)).statusCode).toBe(200);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/complete`,
      headers: { cookie: adminCookie }
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json<BookingDetail>().status).toBe('completed');

    const cancel = await cancelBooking(id, 'Cliente no se presentó');
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json()).toMatchObject({ error: 'invalid_transition' });
  });

  it('requires an admin and a cancellation reason', async () => {
    const id = await fillBooking({
      size: 'large',
      date: '2026-11-11',
      startTime: '09:00',
      durationHours: 1
    });
    expect((await confirmBooking(id)).statusCode).toBe(200);

    const asCustomer = await cancelBooking(id, 'Motivo válido', customerCookie);
    expect(asCustomer.statusCode).toBe(403);

    const withoutReason = await cancelBooking(id, 'no');
    expect(withoutReason.statusCode).toBe(400);

    const cancelled = await cancelBooking(id, 'Cambio de planes del cliente');
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<BookingDetail>()).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'Cambio de planes del cliente'
    });
    expect(cancelled.json<BookingDetail>().cancelledAt).not.toBeNull();

    const reconfirm = await confirmBooking(id);
    expect(reconfirm.statusCode).toBe(409);
    expect(reconfirm.json()).toMatchObject({ error: 'invalid_transition' });
  });

  it('allows cancelling a draft', async () => {
    const id = await createDraft();
    const response = await cancelBooking(id, 'Borrador abandonado');

    expect(response.statusCode).toBe(200);
    expect(response.json<BookingDetail>().status).toBe('cancelled');
  });
});

describe('booking queries and ownership', () => {
  it('paginates and filters the admin list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/bookings?status=confirmed&page=1&pageSize=2',
      headers: { cookie: adminCookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<BookingListResponse>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.total).toBeGreaterThan(2);
    expect(body.items.every((item) => item.status === 'confirmed')).toBe(true);
  });

  it('filters by room', async () => {
    const room = roomBySize('large');
    const response = await app.inject({
      method: 'GET',
      url: `/api/bookings?roomId=${room.id}&status=confirmed&pageSize=50`,
      headers: { cookie: adminCookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<BookingListResponse>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.room?.id === room.id)).toBe(true);
  });

  it('only returns the customer own bookings', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/bookings?pageSize=50',
      headers: { cookie: customerCookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<BookingListResponse>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.customer.id === customerId)).toBe(true);
  });

  it('returns 404 for unknown bookings', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/bookings/999999',
      headers: { cookie: customerCookie }
    });

    expect(response.statusCode).toBe(404);
  });

  it('validates the list query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/bookings?pageSize=500',
      headers: { cookie: adminCookie }
    });

    expect(response.statusCode).toBe(400);
  });
});
