export const APP_NAME = 'Bookking';
export const APP_TIME_ZONE = 'America/Bogota';

export const ROOM_SIZES = ['small', 'medium', 'large'] as const;
export type RoomSize = (typeof ROOM_SIZES)[number];

export const BOOKING_STATUSES = ['draft', 'confirmed', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const USER_ROLES = ['customer', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const EXTRA_SERVICE_CODES = ['projector', 'coffee'] as const;
export type ExtraServiceCode = (typeof EXTRA_SERVICE_CODES)[number];

export const EXTRA_SERVICES = [
  { code: 'projector', label: 'Proyector', unitPrice: 25000 },
  { code: 'coffee', label: 'Café', unitPrice: 15000 }
] as const;

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

export type AuthUser = {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type AuthResponse = {
  user: AuthUser | null;
};

export type CustomerDetails = {
  fullName: string;
  email: string;
  phone: string;
  company: string | null;
};

export type BookingSchedule = {
  roomId: number;
  date: string;
  startTime: string;
  durationHours: number;
};

export type BookingExtraInput = {
  code: ExtraServiceCode;
  quantity: number;
};

export type BookingDraft = {
  customer: CustomerDetails | null;
  schedule: BookingSchedule | null;
  extras: BookingExtraInput[];
  notes: string | null;
};

export type BookingServiceLine = {
  code: ExtraServiceCode;
  label: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

export type BookingSummary = {
  id: number;
  status: BookingStatus;
  currentStep: number;
  customer: {
    id: number;
    fullName: string;
    email: string;
  };
  room: Room | null;
  startsAt: string | null;
  endsAt: string | null;
  total: number | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
};

export type BookingDetail = BookingSummary & {
  draft: BookingDraft;
  quote: PriceBreakdown | null;
  services: BookingServiceLine[];
  servicesTotal: number;
  cancellationReason: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type BookingListResponse = {
  items: BookingSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type BookingCreateRequest = {
  customer?: CustomerDetails;
};

export type BookingUpdateRequest = {
  currentStep?: number;
  customer?: CustomerDetails;
  schedule?: BookingSchedule;
  extras?: BookingExtraInput[];
  notes?: string | null;
};

export type BookingCancelRequest = {
  reason: string;
};
