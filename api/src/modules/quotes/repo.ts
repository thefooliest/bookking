import { DateTime } from 'luxon';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';

export type BookingInterval = {
  startsAt: DateTime;
  endsAt: DateTime;
};

type BookingRow = {
  starts_at: Date;
  ends_at: Date;
};

export async function listConfirmedIntervals(
  roomId: number,
  from: DateTime,
  to: DateTime
): Promise<BookingInterval[]> {
  const result = await pool.query<BookingRow>(
    `SELECT starts_at, ends_at
     FROM bookings
     WHERE room_id = $1
       AND status = 'confirmed'
       AND starts_at < $2
       AND ends_at > $3
     ORDER BY starts_at`,
    [roomId, to.toJSDate(), from.toJSDate()]
  );

  return result.rows.map((row) => ({
    startsAt: DateTime.fromJSDate(row.starts_at, { zone: env.APP_TIME_ZONE }),
    endsAt: DateTime.fromJSDate(row.ends_at, { zone: env.APP_TIME_ZONE })
  }));
}
