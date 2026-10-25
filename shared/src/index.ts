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
