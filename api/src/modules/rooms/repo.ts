import type { Room, RoomSize } from '@bookking/shared';
import { pool } from '../../db/pool.js';

type RoomRow = {
  id: number;
  name: string;
  size: RoomSize;
  hourly_rate: string;
};

function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    hourlyRate: Number(row.hourly_rate)
  };
}

export async function listRooms(): Promise<Room[]> {
  const result = await pool.query<RoomRow>(
    'SELECT id, name, size, hourly_rate FROM rooms ORDER BY hourly_rate'
  );

  return result.rows.map(mapRoom);
}

export async function findRoomById(id: number): Promise<Room | null> {
  const result = await pool.query<RoomRow>(
    'SELECT id, name, size, hourly_rate FROM rooms WHERE id = $1',
    [id]
  );

  const row = result.rows[0];
  return row ? mapRoom(row) : null;
}
