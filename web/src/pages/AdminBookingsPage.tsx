import {
  BOOKING_STATUSES,
  type BookingDetail,
  type BookingListResponse,
  type BookingStatus,
  type Room
} from '@bookking/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '../api/client';
import {
  formatCurrency,
  formatDateTime,
  statusLabels
} from '../lib/format';

const PAGE_SIZE = 8;

function statusClass(status: BookingStatus): string {
  return `status-pill ${status}`;
}

function buildListPath(input: {
  status: BookingStatus | '';
  roomId: string;
  page: number;
}): string {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: String(PAGE_SIZE)
  });

  if (input.status) {
    params.set('status', input.status);
  }
  if (input.roomId) {
    params.set('roomId', input.roomId);
  }

  return `/api/bookings?${params.toString()}`;
}

function BookingDetailPanel({
  booking,
  onClose
}: {
  booking: BookingDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = (updated: BookingDetail): void => {
    queryClient.setQueryData(['admin-booking', String(updated.id)], updated);
    void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
  };

  const cancelMutation = useMutation({
    mutationFn: () =>
      apiFetch<BookingDetail>(`/api/bookings/${booking.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      }),
    onSuccess: (updated) => {
      setReason('');
      setError(null);
      refresh(updated);
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError ? caught.message : 'No fue posible cancelar la reserva.'
      );
    }
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      apiFetch<BookingDetail>(`/api/bookings/${booking.id}/complete`, {
        method: 'POST'
      }),
    onSuccess: (updated) => {
      setError(null);
      refresh(updated);
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError ? caught.message : 'No fue posible completar la reserva.'
      );
    }
  });

  function handleCancel(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    cancelMutation.mutate();
  }

  const canCancel = booking.status === 'draft' || booking.status === 'confirmed';
  const canComplete = booking.status === 'confirmed';

  return (
    <aside className="card admin-detail">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Reserva #{booking.id}</p>
          <h2>{booking.room?.name ?? 'Sala pendiente'}</h2>
        </div>
        <button className="link-button" type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>

      <span className={statusClass(booking.status)}>{statusLabels[booking.status]}</span>

      <dl className="detail-list">
        <div>
          <dt>Cliente</dt>
          <dd>{booking.customer.fullName}</dd>
        </div>
        <div>
          <dt>Correo</dt>
          <dd>{booking.draft.customer?.email ?? booking.customer.email}</dd>
        </div>
        <div>
          <dt>Teléfono</dt>
          <dd>{booking.draft.customer?.phone ?? 'Sin teléfono'}</dd>
        </div>
        <div>
          <dt>Empresa</dt>
          <dd>{booking.draft.customer?.company ?? 'Sin empresa'}</dd>
        </div>
        <div>
          <dt>Horario</dt>
          <dd>
            {booking.startsAt
              ? `${formatDateTime(booking.startsAt)} a ${formatDateTime(booking.endsAt)}`
              : `Borrador en el paso ${booking.currentStep} de 3`}
          </dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{booking.total === null ? 'Por calcular' : formatCurrency(booking.total)}</dd>
        </div>
      </dl>

      {booking.quote && (
        <dl className="breakdown">
          <div className="breakdown-row">
            <dt>Tarifa base</dt>
            <dd>{formatCurrency(booking.quote.base)}</dd>
          </div>
          <div className="breakdown-row">
            <dt>Descuento</dt>
            <dd>-{formatCurrency(booking.quote.discount)}</dd>
          </div>
          <div className="breakdown-row">
            <dt>Recargo sábado</dt>
            <dd>+{formatCurrency(booking.quote.surcharge)}</dd>
          </div>
          <div className="breakdown-row">
            <dt>Servicios</dt>
            <dd>{formatCurrency(booking.servicesTotal)}</dd>
          </div>
          <div className="breakdown-row total">
            <dt>Total reserva</dt>
            <dd>{booking.total === null ? '—' : formatCurrency(booking.total)}</dd>
          </div>
        </dl>
      )}

      {booking.services.length > 0 && (
        <div className="service-summary">
          <h3>Servicios adicionales</h3>
          <ul>
            {booking.services.map((service) => (
              <li key={service.code}>
                <span>
                  {service.label} × {service.quantity}
                </span>
                <strong>{formatCurrency(service.subtotal)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {booking.draft.notes && (
        <div className="admin-notes">
          <h3>Notas</h3>
          <p>{booking.draft.notes}</p>
        </div>
      )}

      {booking.cancellationReason && (
        <p className="reason">Motivo de cancelación: {booking.cancellationReason}</p>
      )}

      {error && <p className="error">{error}</p>}

      {canComplete && (
        <button
          className="button secondary"
          type="button"
          onClick={() => completeMutation.mutate()}
          disabled={completeMutation.isPending}
        >
          {completeMutation.isPending ? 'Completando...' : 'Marcar como completada'}
        </button>
      )}

      {canCancel && (
        <form className="cancel-form" onSubmit={handleCancel}>
          <label className="field">
            <span>Motivo de cancelación</span>
            <textarea
              rows={3}
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explica por qué se cancela la reserva"
              required
            />
          </label>
          <button className="button danger" type="submit" disabled={cancelMutation.isPending}>
            {cancelMutation.isPending ? 'Cancelando...' : 'Cancelar reserva'}
          </button>
        </form>
      )}
    </aside>
  );
}

export function AdminBookingsPage() {
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [roomId, setRoomId] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const roomsQuery = useQuery({
    queryKey: ['rooms'],
    queryFn: () => apiFetch<Room[]>('/api/rooms')
  });

  const bookingsQuery = useQuery({
    queryKey: ['admin-bookings', status, roomId, page],
    queryFn: () =>
      apiFetch<BookingListResponse>(buildListPath({ status, roomId, page }))
  });

  const detailQuery = useQuery({
    queryKey: ['admin-booking', String(selectedId)],
    queryFn: () => apiFetch<BookingDetail>(`/api/bookings/${selectedId}`),
    enabled: selectedId !== null,
    retry: false
  });

  useEffect(() => {
    setPage(1);
  }, [status, roomId]);

  useEffect(() => {
    if (detailQuery.data) {
      setSelectedId(detailQuery.data.id);
    }
  }, [detailQuery.data]);

  const total = bookingsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Administración</p>
        <h1>Reservas del coworking</h1>
        <p className="lede">
          Filtra por estado o sala, revisa el detalle y gestiona las reservas.
        </p>
      </section>

      <div className="admin-layout">
        <section className="card admin-list-card">
          <div className="filters">
            <label className="field">
              <span>Estado</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as BookingStatus | '')}
              >
                <option value="">Todos</option>
                {BOOKING_STATUSES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {statusLabels[candidate]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Sala</span>
              <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                <option value="">Todas</option>
                {roomsQuery.data?.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {bookingsQuery.isPending && <p className="empty-state">Cargando reservas...</p>}
          {bookingsQuery.isError && (
            <p className="error">No fue posible cargar las reservas.</p>
          )}

          {bookingsQuery.data && bookingsQuery.data.items.length === 0 && (
            <p className="empty-state">No hay reservas con esos filtros.</p>
          )}

          {bookingsQuery.data && bookingsQuery.data.items.length > 0 && (
            <>
              <div className="table-wrap">
                <table className="booking-table">
                  <thead>
                    <tr>
                      <th>Reserva</th>
                      <th>Cliente</th>
                      <th>Sala</th>
                      <th>Horario</th>
                      <th>Estado</th>
                      <th>Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {bookingsQuery.data.items.map((booking) => (
                      <tr
                        key={booking.id}
                        className={selectedId === booking.id ? 'selected' : ''}
                      >
                        <td>#{booking.id}</td>
                        <td>{booking.customer.fullName}</td>
                        <td>{booking.room?.name ?? '—'}</td>
                        <td>
                          {booking.startsAt
                            ? formatDateTime(booking.startsAt)
                            : `Paso ${booking.currentStep}/3`}
                        </td>
                        <td>
                          <span className={statusClass(booking.status)}>
                            {statusLabels[booking.status]}
                          </span>
                        </td>
                        <td>
                          {booking.total === null
                            ? '—'
                            : formatCurrency(booking.total)}
                        </td>
                        <td>
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => setSelectedId(booking.id)}
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pagination">
                <button
                  className="button secondary"
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Anterior
                </button>
                <span className="hint">
                  Página {page} de {totalPages} · {total} reservas
                </span>
                <button
                  className="button secondary"
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Siguiente
                </button>
              </div>
            </>
          )}
        </section>

        {selectedId !== null && detailQuery.isPending && (
          <aside className="card admin-detail">
            <p className="empty-state">Cargando detalle...</p>
          </aside>
        )}

        {selectedId !== null && detailQuery.isError && (
          <aside className="card admin-detail">
            <p className="error">No fue posible cargar el detalle.</p>
            <button className="link-button" type="button" onClick={() => setSelectedId(null)}>
              Cerrar
            </button>
          </aside>
        )}

        {detailQuery.data && (
          <BookingDetailPanel
            key={detailQuery.data.id}
            booking={detailQuery.data}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </>
  );
}
