import type {
  BookingDetail,
  BookingDraft,
  BookingListResponse,
  CustomerDetails,
  PriceBreakdown,
  UserRole
} from '@bookking/shared';
import { pool } from '../../db/pool.js';
import { parseDateTime } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { enqueueBookingConfirmation } from '../email/booking-confirmation.js';
import { createQuote } from '../quotes/service.js';
import {
  createDraftBooking,
  findBookingForUpdate,
  getBookingDetail,
  listBookings,
  markBookingCancelled,
  markBookingCompleted,
  markBookingConfirmed,
  replaceBookingServices,
  updateDraftBooking
} from './repo.js';
import { bookingDraftSchema, type BookingListQuery, type BookingUpdateInput } from './schemas.js';
import { buildServiceLines, servicesTotal } from './services.js';
import { assertTransition } from './state.js';

function emptyDraft(): BookingDraft {
  return { customer: null, schedule: null, extras: [], notes: null };
}

function parseDraft(value: unknown): BookingDraft {
  const parsed = bookingDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyDraft();
}

function priceBreakdown(quote: {
  base: number;
  discount: number;
  discountPercent: number;
  surcharge: number;
  surchargePercent: number;
  total: number;
  currency: 'COP';
}): PriceBreakdown {
  return {
    base: quote.base,
    discount: quote.discount,
    discountPercent: quote.discountPercent,
    surcharge: quote.surcharge,
    surchargePercent: quote.surchargePercent,
    total: quote.total,
    currency: quote.currency
  };
}

async function detailOrThrow(
  id: number,
  userId: number,
  role: UserRole
): Promise<BookingDetail> {
  const booking = await getBookingDetail(id, userId, role);
  if (!booking) {
    throw new AppError(404, 'booking_not_found', 'La reserva no existe.');
  }
  return booking;
}

export async function createBooking(
  userId: number,
  customer?: CustomerDetails
): Promise<BookingDetail> {
  const draft: BookingDraft = {
    ...emptyDraft(),
    customer: customer ?? null
  };
  const id = await createDraftBooking(userId, draft);
  return detailOrThrow(id, userId, 'customer');
}

export async function updateBooking(
  id: number,
  userId: number,
  input: BookingUpdateInput
): Promise<BookingDetail> {
  let quoted = null;

  if (input.schedule) {
    const quote = await createQuote(input.schedule);
    if (!quote.available) {
      throw new AppError(
        409,
        'slot_unavailable',
        quote.reason ?? 'El horario seleccionado no está disponible.',
        quote
      );
    }
    quoted = quote;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await findBookingForUpdate(client, id);
    if (!current || current.customer_id !== userId) {
      throw new AppError(404, 'booking_not_found', 'La reserva no existe.');
    }

    if (current.status !== 'draft') {
      throw new AppError(
        409,
        'booking_not_editable',
        'Solo se pueden editar reservas en borrador.'
      );
    }

    const draft = parseDraft(current.draft_data);
    const nextDraft: BookingDraft = {
      customer: input.customer ?? draft.customer,
      schedule: input.schedule ?? draft.schedule,
      extras: input.extras ?? draft.extras,
      notes: input.notes !== undefined ? input.notes : draft.notes
    };

    const derivedStep = nextDraft.schedule
      ? input.extras !== undefined ||
        input.notes !== undefined ||
        nextDraft.extras.length > 0 ||
        nextDraft.notes !== null
        ? 3
        : 2
      : 1;
    const nextStep = Math.max(
      current.current_step,
      input.currentStep ?? derivedStep
    );

    if (nextStep >= 2 && !nextDraft.customer) {
      throw new AppError(
        400,
        'incomplete_step',
        'Completa los datos del cliente antes de continuar.'
      );
    }

    if (nextStep >= 3 && !nextDraft.schedule) {
      throw new AppError(
        400,
        'incomplete_step',
        'Selecciona la sala y el horario antes de continuar.'
      );
    }

    const lines = buildServiceLines(nextDraft.extras);
    const servicesSubtotal = servicesTotal(lines);

    let roomId = current.room_id;
    let startsAt = current.starts_at;
    let endsAt = current.ends_at;
    let quote = (current.quote as PriceBreakdown | null) ?? null;

    if (quoted) {
      roomId = quoted.room.id;
      startsAt = parseDateTime(quoted.date, quoted.startTime).toJSDate();
      endsAt = parseDateTime(quoted.date, quoted.endTime).toJSDate();
      quote = priceBreakdown(quoted);
    }

    await updateDraftBooking(client, id, {
      draftData: nextDraft,
      currentStep: nextStep,
      roomId,
      startsAt,
      endsAt,
      quote,
      total: quote ? quote.total + servicesSubtotal : null
    });
    await replaceBookingServices(client, id, lines);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return detailOrThrow(id, userId, 'customer');
}

export async function confirmBooking(
  id: number,
  userId: number
): Promise<BookingDetail> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await findBookingForUpdate(client, id);
    if (!current || current.customer_id !== userId) {
      throw new AppError(404, 'booking_not_found', 'La reserva no existe.');
    }

    if (current.status === 'confirmed') {
      await enqueueBookingConfirmation(client, id);
      await client.query('COMMIT');
    } else {
      assertTransition(current.status, 'confirmed');

      const draft = parseDraft(current.draft_data);
      if (
        current.current_step < 3 ||
        !draft.customer ||
        !current.room_id ||
        !current.starts_at ||
        !current.ends_at ||
        !current.quote ||
        current.total === null
      ) {
        throw new AppError(
          409,
          'incomplete_booking',
          'Completa los tres pasos antes de confirmar la reserva.'
        );
      }

      const confirmed = await markBookingConfirmed(client, id);
      if (!confirmed) {
        throw new AppError(
          409,
          'invalid_transition',
          'No se pudo confirmar la reserva en su estado actual.'
        );
      }

      await enqueueBookingConfirmation(client, id);
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK');

    if ((error as { code?: string }).code === '23P01') {
      throw new AppError(
        409,
        'slot_taken',
        'Ese horario acaba de ser reservado. Vuelve a cotizar para elegir otro.'
      );
    }

    throw error;
  } finally {
    client.release();
  }

  return detailOrThrow(id, userId, 'customer');
}

export async function cancelBooking(
  id: number,
  adminId: number,
  reason: string
): Promise<BookingDetail> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await findBookingForUpdate(client, id);
    if (!current) {
      throw new AppError(404, 'booking_not_found', 'La reserva no existe.');
    }

    assertTransition(current.status, 'cancelled');
    await markBookingCancelled(client, id, reason);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return detailOrThrow(id, adminId, 'admin');
}

export async function completeBooking(
  id: number,
  adminId: number
): Promise<BookingDetail> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const current = await findBookingForUpdate(client, id);
    if (!current) {
      throw new AppError(404, 'booking_not_found', 'La reserva no existe.');
    }

    assertTransition(current.status, 'completed');
    await markBookingCompleted(client, id);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return detailOrThrow(id, adminId, 'admin');
}

export async function getBooking(
  id: number,
  userId: number,
  role: UserRole
): Promise<BookingDetail> {
  return detailOrThrow(id, userId, role);
}

export async function getBookings(input: {
  userId: number;
  role: UserRole;
  query: BookingListQuery;
}): Promise<BookingListResponse> {
  return listBookings({
    userId: input.userId,
    role: input.role,
    status: input.query.status,
    roomId: input.query.roomId,
    page: input.query.page,
    pageSize: input.query.pageSize
  });
}
