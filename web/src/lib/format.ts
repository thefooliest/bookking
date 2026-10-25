import {
  APP_TIME_ZONE,
  type BookingStatus,
  type EmailStatus
} from '@bookking/shared';

export const currencyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
}

export function formatLongDate(date: string): string {
  return new Date(`${date}T12:00:00-05:00`).toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: APP_TIME_ZONE
  });
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Sin fecha';
  }

  return new Date(value).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: APP_TIME_ZONE
  });
}

export function formatTime(value: string | null): string {
  if (!value) {
    return '--:--';
  }

  return new Date(value).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: APP_TIME_ZONE
  });
}

export const statusLabels: Record<BookingStatus, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada'
};

export const emailStatusLabels: Record<EmailStatus, string> = {
  pending: 'Pendiente',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Fallido'
};
