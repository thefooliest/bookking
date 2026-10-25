import {
  EXTRA_SERVICES,
  type BookingDetail,
  type BookingEmailStatus,
  type BookingDraft,
  type BookingListResponse,
  type BookingServiceLine,
  type BookingStatus,
  type BookingSummary,
  type EmailStatus,
  type PriceBreakdown,
  type RoomSize,
  type UserRole
} from '@bookking/shared';
import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { bookingDraftSchema } from './schemas.js';
import { servicesTotal } from './services.js';

type BookingRow = {
  id: number;
  customer_id: number;
  room_id: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  status: BookingStatus;
  current_step: number;
  draft_data: unknown;
  quote: unknown;
  total: string | null;
  cancellation_reason: string | null;
  created_at: Date;
  updated_at: Date;
  confirmed_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  customer_full_name: string;
  customer_email: string;
  room_name: string | null;
  room_size: RoomSize | null;
  room_hourly_rate: string | null;
};

type ServiceRow = {
  code: BookingServiceLine['code'];
  quantity: number;
  unit_price: string;
};

type EmailRow = {
  status: EmailStatus;
  attempts: number;
  recipient: string;
  last_error: string | null;
  next_attempt_at: Date;
  sent_at: Date | null;
};

type BookingLockRow = {
  id: number;
  customer_id: number;
  status: BookingStatus;
  current_step: number;
  room_id: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  quote: unknown;
  total: string | null;
  draft_data: unknown;
};

const BOOKING_SELECT = `
  SELECT b.*,
         u.full_name AS customer_full_name,
         u.email AS customer_email,
         r.name AS room_name,
         r.size AS room_size,
         r.hourly_rate AS room_hourly_rate
  FROM bookings b
  JOIN users u ON u.id = b.customer_id
  LEFT JOIN rooms r ON r.id = b.room_id
`;

function toIso(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  return (
    DateTime.fromJSDate(value, { zone: env.APP_TIME_ZONE }).toISO() ??
    value.toISOString()
  );
}

function parseDraft(value: unknown): BookingDraft {
  const parsed = bookingDraftSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  return { customer: null, schedule: null, extras: [], notes: null };
}

function mapSummary(row: BookingRow): BookingSummary {
  return {
    id: row.id,
    status: row.status,
    currentStep: row.current_step,
    customer: {
      id: row.customer_id,
      fullName: row.customer_full_name,
      email: row.customer_email
    },
    room:
      row.room_id && row.room_name && row.room_size && row.room_hourly_rate
        ? {
            id: row.room_id,
            name: row.room_name,
            size: row.room_size,
            hourlyRate: Number(row.room_hourly_rate)
          }
        : null,
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    total: row.total === null ? null : Number(row.total),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
    confirmedAt: toIso(row.confirmed_at)
  };
}

function mapServiceLine(row: ServiceRow): BookingServiceLine {
  const catalogItem = EXTRA_SERVICES.find((item) => item.code === row.code);
  const unitPrice = Number(row.unit_price);

  return {
    code: row.code,
    label: catalogItem?.label ?? row.code,
    quantity: row.quantity,
    unitPrice,
    subtotal: unitPrice * row.quantity
  };
}

async function getEmailStatus(bookingId: number): Promise<BookingEmailStatus | null> {
  const result = await pool.query<EmailRow>(
    `SELECT status, attempts, recipient, last_error, next_attempt_at, sent_at
     FROM email_outbox
     WHERE booking_id = $1 AND kind = 'booking_confirmation'`,
    [bookingId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    status: row.status,
    attempts: row.attempts,
    recipient: row.recipient,
    lastError: row.last_error,
    nextAttemptAt: toIso(row.next_attempt_at) as string,
    sentAt: toIso(row.sent_at)
  };
}

async function listServices(bookingId: number): Promise<BookingServiceLine[]> {
  const result = await pool.query<ServiceRow>(
    `SELECT code, quantity, unit_price
     FROM booking_services
     WHERE booking_id = $1
     ORDER BY code`,
    [bookingId]
  );

  return result.rows.map(mapServiceLine);
}

export async function getBookingDetail(
  id: number,
  userId: number,
  role: UserRole
): Promise<BookingDetail | null> {
  const params: unknown[] = [id];
  let ownershipFilter = '';

  if (role === 'customer') {
    params.push(userId);
    ownershipFilter = 'AND b.customer_id = $2';
  }

  const result = await pool.query<BookingRow>(
    `${BOOKING_SELECT} WHERE b.id = $1 ${ownershipFilter}`,
    params
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const [services, email] = await Promise.all([
    listServices(row.id),
    getEmailStatus(row.id)
  ]);

  return {
    ...mapSummary(row),
    draft: parseDraft(row.draft_data),
    quote: (row.quote as PriceBreakdown | null) ?? null,
    services,
    servicesTotal: servicesTotal(services),
    cancellationReason: row.cancellation_reason,
    completedAt: toIso(row.completed_at),
    cancelledAt: toIso(row.cancelled_at),
    email
  };
}

export async function listBookings(input: {
  userId: number;
  role: UserRole;
  status?: BookingStatus;
  roomId?: number;
  page: number;
  pageSize: number;
}): Promise<BookingListResponse> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.role === 'customer') {
    params.push(input.userId);
    conditions.push(`b.customer_id = $${params.length}`);
  }

  if (input.status) {
    params.push(input.status);
    conditions.push(`b.status = $${params.length}`);
  }

  if (input.roomId) {
    params.push(input.roomId);
    conditions.push(`b.room_id = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM bookings b ${where}`,
    params
  );

  const offset = (input.page - 1) * input.pageSize;
  const listParams = [...params, input.pageSize, offset];
  const result = await pool.query<BookingRow>(
    `${BOOKING_SELECT}
     ${where}
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return {
    items: result.rows.map(mapSummary),
    total: countResult.rows[0]?.count ?? 0,
    page: input.page,
    pageSize: input.pageSize
  };
}

export async function createDraftBooking(
  customerId: number,
  draft: BookingDraft
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO bookings (customer_id, status, current_step, draft_data)
     VALUES ($1, 'draft', 1, $2::jsonb)
     RETURNING id`,
    [customerId, JSON.stringify(draft)]
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('No se pudo crear el borrador de la reserva.');
  }

  return id;
}

export async function findBookingForUpdate(
  client: PoolClient,
  id: number
): Promise<BookingLockRow | null> {
  const result = await client.query<BookingLockRow>(
    `SELECT id, customer_id, status, current_step, room_id, starts_at, ends_at, quote, total, draft_data
     FROM bookings
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function updateDraftBooking(
  client: PoolClient,
  id: number,
  fields: {
    draftData: BookingDraft;
    currentStep: number;
    roomId: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    quote: PriceBreakdown | null;
    total: number | null;
  }
): Promise<void> {
  await client.query(
    `UPDATE bookings
     SET draft_data = $2::jsonb,
         current_step = $3,
         room_id = $4,
         starts_at = $5,
         ends_at = $6,
         quote = $7::jsonb,
         total = $8,
         updated_at = now()
     WHERE id = $1`,
    [
      id,
      JSON.stringify(fields.draftData),
      fields.currentStep,
      fields.roomId,
      fields.startsAt,
      fields.endsAt,
      fields.quote ? JSON.stringify(fields.quote) : null,
      fields.total
    ]
  );
}

export async function replaceBookingServices(
  client: PoolClient,
  bookingId: number,
  lines: BookingServiceLine[]
): Promise<void> {
  await client.query('DELETE FROM booking_services WHERE booking_id = $1', [bookingId]);

  for (const line of lines) {
    await client.query(
      `INSERT INTO booking_services (booking_id, code, quantity, unit_price)
       VALUES ($1, $2, $3, $4)`,
      [bookingId, line.code, line.quantity, line.unitPrice]
    );
  }
}

export async function markBookingConfirmed(
  client: PoolClient,
  id: number
): Promise<boolean> {
  const result = await client.query(
    `UPDATE bookings
     SET status = 'confirmed', confirmed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'draft'`,
    [id]
  );

  return result.rowCount === 1;
}

export async function markBookingCancelled(
  client: PoolClient,
  id: number,
  reason: string
): Promise<void> {
  await client.query(
    `UPDATE bookings
     SET status = 'cancelled',
         cancellation_reason = $2,
         cancelled_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [id, reason]
  );
}

export async function markBookingCompleted(
  client: PoolClient,
  id: number
): Promise<void> {
  await client.query(
    `UPDATE bookings
     SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id]
  );
}
