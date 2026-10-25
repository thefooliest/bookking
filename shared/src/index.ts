export const APP_NAME = 'Bookking';
export const APP_TIME_ZONE = 'America/Bogota';

export const ROOM_SIZES = ['small', 'medium', 'large'] as const;
export type RoomSize = (typeof ROOM_SIZES)[number];

export const BOOKING_STATUSES = ['draft', 'confirmed', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const USER_ROLES = ['customer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EXTRA_SERVICES = [
  { code: 'projector', label: 'Proyector', unitPrice: 25000 },
  { code: 'coffee', label: 'Café', unitPrice: 15000 }
] as const;

export type ExtraServiceCode = (typeof EXTRA_SERVICES)[number]['code'];

export type Room = {
  id: number;
  name: string;
  size: RoomSize;
  hourlyRate: number;
};

export type QuoteRequest = {
  roomId: number;
  date: string;
  startTime: string;
  durationHours: number;
};

export type PriceBreakdown = {
  base: number;
  discount: number;
  discountPercent: number;
  surcharge: number;
  surchargePercent: number;
  total: number;
  currency: 'COP';
};

export type NextAvailableSlot = {
  startTime: string;
  endTime: string;
};

export type QuoteResponse = PriceBreakdown & {
  room: Room;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  available: boolean;
  reason: string | null;
  nextAvailable: NextAvailableSlot | null;
};

export type ApiErrorBody = {
  error: string;
  message: string;
  details?: unknown;
};
