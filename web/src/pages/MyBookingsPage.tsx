import type { BookingListResponse } from '@bookking/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { formatCurrency, formatDateTime, statusLabels } from '../lib/format';

export function MyBookingsPage() {
  const bookingsQuery = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => apiFetch<BookingListResponse>('/api/bookings?pageSize=50')
  });

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Tu cuenta</p>
        <h1>Mis reservas</h1>
        <p className="lede">
          Retoma un borrador donde lo dejaste o revisa tus reservas confirmadas.
        </p>
      </section>

      {bookingsQuery.isPending && <p className="empty-state">Cargando reservas...</p>}
      {bookingsQuery.isError && (
        <p className="error">No fue posible cargar tus reservas.</p>
      )}

      {bookingsQuery.data && bookingsQuery.data.items.length === 0 && (
        <section className="card empty-card">
          <h2>Aún no tienes reservas</h2>
          <p className="muted">Cotiza una sala y guarda tu primera reserva.</p>
          <Link className="button" to="/cotizar">
            Cotizar una sala
          </Link>
        </section>
      )}

      {bookingsQuery.data && bookingsQuery.data.items.length > 0 && (
        <div className="booking-list">
          {bookingsQuery.data.items.map((booking) => (
            <article className="card booking-card" key={booking.id}>
              <div className="booking-card-main">
                <div>
                  <div className="booking-title">
                    <h2>{booking.room?.name ?? 'Sala pendiente'}</h2>
                    <span className={`status-pill ${booking.status}`}>
                      {statusLabels[booking.status]}
                    </span>
                  </div>
                  <p className="muted">
                    {booking.startsAt
                      ? `${formatDateTime(booking.startsAt)} a ${formatDateTime(booking.endsAt)}`
                      : `Borrador en el paso ${booking.currentStep} de 3`}
                  </p>
                </div>

                <div className="booking-total">
                  <span>Total</span>
                  <strong>
                    {booking.total === null ? 'Por calcular' : formatCurrency(booking.total)}
                  </strong>
                </div>
              </div>

              <div className="booking-card-actions">
                <span className="hint">Reserva #{booking.id}</span>
                {booking.status === 'draft' ? (
                  <Link className="button" to={`/reservar/${booking.id}`}>
                    Continuar borrador
                  </Link>
                ) : (
                  <Link className="button secondary" to={`/reservar/${booking.id}`}>
                    Ver detalle
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
