import type { QuoteResponse, Room, RoomSize } from '@bookking/shared';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { closePool, pool } from '../src/db/pool.js';
import { resetDatabase } from '../src/db/reset.js';
import { seed } from '../src/db/seed.js';

const app = buildApp();
const zone = 'America/Bogota';

beforeAll(async () => {
  await resetDatabase();
  await migrate();
  await seed();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function listRooms(): Promise<Room[]> {
  const response = await app.inject({ method: 'GET', url: '/api/rooms' });
  expect(response.statusCode).toBe(200);
  return response.json<Room[]>();
}

async function roomBySize(size: RoomSize): Promise<Room> {
  const rooms = await listRooms();
  const room = rooms.find((candidate) => candidate.size === size);
  if (!room) {
    throw new Error(`Room ${size} not found`);
  }
  return room;
}

async function quote(payload: {
  roomId: number;
  date: string;
  startTime: string;
  durationHours: number;
}) {
  return app.inject({ method: 'POST', url: '/api/quotes', payload });
}

async function insertConfirmedBooking(
  roomId: number,
  startsAt: string,
  endsAt: string
): Promise<void> {
  const customer = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE email = $1',
    ['cliente@bookking.local']
  );
  const customerId = customer.rows[0]?.id;
  expect(customerId).toBeDefined();

  await pool.query(
    `INSERT INTO bookings
       (customer_id, room_id, starts_at, ends_at, status, current_step, quote, total, confirmed_at)
     VALUES ($1, $2, $3, $4, 'confirmed', 3, $5::jsonb, $6, now())`,
    [
      customerId,
      roomId,
      DateTime.fromISO(startsAt, { zone }).toJSDate(),
      DateTime.fromISO(endsAt, { zone }).toJSDate(),
      JSON.stringify({
        base: 40000,
        discount: 0,
        surcharge: 0,
        total: 40000,
        currency: 'COP'
      }),
      40000
    ]
  );
}

describe('GET /api/rooms', () => {
  it('returns the seeded rooms ordered by rate', async () => {
    const rooms = await listRooms();

    expect(rooms.map((room) => room.size)).toEqual(['small', 'medium', 'large']);
    expect(rooms[0]).toMatchObject({ hourlyRate: 40000 });
  });
});

describe('POST /api/quotes', () => {
  it('quotes a weekday without discount or surcharge', async () => {
    const small = await roomBySize('small');
    const response = await quote({
      roomId: small.id,
      date: '2026-11-02',
      startTime: '09:00',
      durationHours: 1
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<QuoteResponse>()).toMatchObject({
      available: true,
      base: 40000,
      discount: 0,
      surcharge: 0,
      total: 40000,
      startTime: '09:00',
      endTime: '10:00',
      reason: null,
      nextAvailable: null
    });
  });

  it('applies the discount and Saturday surcharge', async () => {
    const small = await roomBySize('small');
    const response = await quote({
      roomId: small.id,
      date: '2026-11-07',
      startTime: '09:00',
      durationHours: 4
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<QuoteResponse>()).toMatchObject({
      available: true,
      base: 160000,
      discount: 16000,
      discountPercent: 10,
      surcharge: 36000,
      surchargePercent: 25,
      total: 180000,
      endTime: '13:00'
    });
  });

  it('rejects Sunday bookings with a reason', async () => {
    const small = await roomBySize('small');
    const response = await quote({
      roomId: small.id,
      date: '2026-11-08',
      startTime: '09:00',
      durationHours: 1
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<QuoteResponse>()).toMatchObject({
      available: false,
      reason: 'La sala no abre los domingos.'
    });
  });

  it('rejects schedules outside the opening hours', async () => {
    const small = await roomBySize('small');
    const response = await quote({
      roomId: small.id,
      date: '2026-11-02',
      startTime: '20:00',
      durationHours: 2
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<QuoteResponse>()).toMatchObject({
      available: false,
      reason: 'El horario debe estar entre las 07:00 y las 21:00.'
    });
  });

  it('detects overlaps and suggests the next available slot', async () => {
    const small = await roomBySize('small');
    await insertConfirmedBooking(
      small.id,
      '2026-11-02T10:00',
      '2026-11-02T11:00'
    );

    const response = await quote({
      roomId: small.id,
      date: '2026-11-02',
      startTime: '09:30',
      durationHours: 1
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<QuoteResponse>()).toMatchObject({
      available: false,
      reason: 'La sala ya está reservada en ese horario.',
      nextAvailable: { startTime: '11:00', endTime: '12:00' }
    });
  });

  it('does not treat a booking ending exactly at the start as an overlap', async () => {
    const medium = await roomBySize('medium');

    await insertConfirmedBooking(
      medium.id,
      '2026-11-02T08:00',
      '2026-11-02T10:00'
    );

    const response = await quote({
      roomId: medium.id,
      date: '2026-11-02',
      startTime: '10:00',
      durationHours: 1
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<QuoteResponse>()).toMatchObject({ available: true });
  });

  it('rejects durations outside the allowed blocks', async () => {
    const small = await roomBySize('small');
    const response = await quote({
      roomId: small.id,
      date: '2026-11-02',
      startTime: '09:00',
      durationHours: 0.5
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_error' });
  });

  it('rejects start times that are not aligned to 30 minutes', async () => {
    const small = await roomBySize('small');
    const response = await quote({
      roomId: small.id,
      date: '2026-11-02',
      startTime: '09:15',
      durationHours: 1
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_error' });
  });
});
