import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { bookingDraftSchema } from '../bookings/schemas.js';

type ConfirmationRow = {
  id: number;
  starts_at: Date;
  ends_at: Date;
  total: string;
  draft_data: unknown;
  account_email: string;
  room_name: string | null;
};

const currencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: env.APP_TIME_ZONE
});

const timeFormatter = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: env.APP_TIME_ZONE
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function enqueueBookingConfirmation(
  client: PoolClient,
  bookingId: number
): Promise<void> {
  const result = await client.query<ConfirmationRow>(
    `SELECT b.id,
            b.starts_at,
            b.ends_at,
            b.total,
            b.draft_data,
            u.email AS account_email,
            r.name AS room_name
     FROM bookings b
     JOIN users u ON u.id = b.customer_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE b.id = $1`,
    [bookingId]
  );

  const row = result.rows[0];
  if (!row) {
    return;
  }

  const draft = bookingDraftSchema.safeParse(row.draft_data);
  const customer = draft.success ? draft.data.customer : null;
  const recipient = customer?.email ?? row.account_email;
  const customerName = customer?.fullName ?? 'cliente';
  const roomName = row.room_name ?? 'Sala por confirmar';
  const total = Number(row.total);
  const startDate = dateFormatter.format(row.starts_at);
  const endTime = timeFormatter.format(row.ends_at);
  const messageId = `<booking-${bookingId}-confirmation@bookking.local>`;
  const subject = `Reserva #${bookingId} confirmada · Bookking`;

  const text = [
    `Hola ${customerName},`,
    '',
    'Tu reserva en Bookking quedó confirmada.',
    '',
    `Reserva: #${bookingId}`,
    `Sala: ${roomName}`,
    `Fecha: ${startDate} a ${endTime}`,
    `Total: ${currencyFormatter.format(total)}`,
    '',
    'Te esperamos en el coworking.'
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1c2430; line-height: 1.6">
      <h1 style="font-size: 24px">Tu reserva está confirmada</h1>
      <p>Hola ${escapeHtml(customerName)},</p>
      <p>Tu reserva en Bookking quedó confirmada.</p>
      <table style="border-collapse: collapse">
        <tr><td style="padding: 4px 16px 4px 0"><strong>Reserva</strong></td><td>#${bookingId}</td></tr>
        <tr><td style="padding: 4px 16px 4px 0"><strong>Sala</strong></td><td>${escapeHtml(roomName)}</td></tr>
        <tr><td style="padding: 4px 16px 4px 0"><strong>Fecha</strong></td><td>${escapeHtml(startDate)} a ${escapeHtml(endTime)}</td></tr>
        <tr><td style="padding: 4px 16px 4px 0"><strong>Total</strong></td><td>${escapeHtml(currencyFormatter.format(total))}</td></tr>
      </table>
      <p>Te esperamos en el coworking.</p>
    </div>
  `;

  await client.query(
    `INSERT INTO email_outbox
       (booking_id, kind, recipient, subject, body_text, body_html, message_id)
     VALUES ($1, 'booking_confirmation', $2, $3, $4, $5, $6)
     ON CONFLICT (booking_id, kind) DO NOTHING`,
    [bookingId, recipient, subject, text, html, messageId]
  );
}
