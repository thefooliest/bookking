import type { QuoteRequest, QuoteResponse, Room } from '@bookking/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiFetch } from '../api/client';
import { currencyFormatter, formatLongDate, today } from '../lib/format';

const durationOptions = Array.from({ length: 19 }, (_, index) => 1 + index * 0.5);

function QuoteResult({ quote }: { quote: QuoteResponse }) {
  return (
    <>
      <div className="result-heading">
        <div>
          <p className="eyebrow">{quote.available ? 'Disponible' : 'No disponible'}</p>
          <h2>{quote.room.name}</h2>
        </div>
        <span className={`badge ${quote.available ? 'available' : 'unavailable'}`}>
          {quote.available ? 'Se puede reservar' : 'No se puede reservar'}
        </span>
      </div>

      <p className="muted">
        {formatLongDate(quote.date)} · {quote.startTime} a {quote.endTime} ·{' '}
        {quote.durationHours} h
      </p>

      <dl className="breakdown">
        <div className="breakdown-row">
          <dt>Tarifa base</dt>
          <dd>{currencyFormatter.format(quote.base)}</dd>
        </div>
        <div className="breakdown-row">
          <dt>Descuento ({quote.discountPercent}%)</dt>
          <dd>-{currencyFormatter.format(quote.discount)}</dd>
        </div>
        <div className="breakdown-row">
          <dt>Recargo sábado ({quote.surchargePercent}%)</dt>
          <dd>+{currencyFormatter.format(quote.surcharge)}</dd>
        </div>
        <div className="breakdown-row total">
          <dt>Total</dt>
          <dd>{currencyFormatter.format(quote.total)}</dd>
        </div>
      </dl>

      {quote.reason && <p className="reason">{quote.reason}</p>}

      {quote.nextAvailable && (
        <p className="next-slot">
          Siguiente horario disponible ese día: {quote.nextAvailable.startTime} a{' '}
          {quote.nextAvailable.endTime}.
        </p>
      )}

      {quote.available && (
        <Link className="button" to="/reservar" state={{ quote }}>
          Continuar con la reserva
        </Link>
      )}
    </>
  );
}

export function QuotePage() {
  const [roomId, setRoomId] = useState('');
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState('09:00');
  const [durationHours, setDurationHours] = useState(1);

  const roomsQuery = useQuery({
    queryKey: ['rooms'],
    queryFn: () => apiFetch<Room[]>('/api/rooms')
  });

  useEffect(() => {
    const firstRoom = roomsQuery.data?.[0];
    if (firstRoom && roomId === '') {
      setRoomId(String(firstRoom.id));
    }
  }, [roomId, roomsQuery.data]);

  const quoteMutation = useMutation({
    mutationFn: (input: QuoteRequest) =>
      apiFetch<QuoteResponse>('/api/quotes', {
        method: 'POST',
        body: JSON.stringify(input)
      })
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    quoteMutation.mutate({
      roomId: Number(roomId),
      date,
      startTime,
      durationHours
    });
  }

  const errorMessage =
    quoteMutation.error instanceof ApiError
      ? quoteMutation.error.message
      : 'No fue posible calcular la cotización.';

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Paso 1</p>
        <h1>Cotiza tu sala</h1>
        <p className="lede">
          Elige la sala y el horario. Verás el desglose y, si no hay cupo, el siguiente
          horario libre de ese día.
        </p>
      </section>

      <div className="quote-layout">
        <form className="card form-card" onSubmit={handleSubmit}>
          <label className="field">
            <span>Sala</span>
            <select
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              required
            >
              {roomsQuery.isPending && <option value="">Cargando salas...</option>}
              {roomsQuery.data?.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name} · {currencyFormatter.format(room.hourlyRate)}/hora
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Fecha</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Hora de inicio</span>
              <input
                type="time"
                step={1800}
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Duración</span>
              <select
                value={durationHours}
                onChange={(event) => setDurationHours(Number(event.target.value))}
              >
                {durationOptions.map((hours) => (
                  <option key={hours} value={hours}>
                    {hours} {hours === 1 ? 'hora' : 'horas'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button className="button" type="submit" disabled={quoteMutation.isPending}>
            {quoteMutation.isPending ? 'Calculando...' : 'Calcular cotización'}
          </button>

          <p className="hint">
            Horario de atención: lunes a sábado, 07:00 a 21:00. Domingos cerrado.
          </p>
        </form>

        <section className="card result-card">
          {quoteMutation.isIdle && (
            <p className="empty-state">
              Completa el formulario para ver el desglose y la disponibilidad.
            </p>
          )}
          {quoteMutation.isPending && <p className="empty-state">Calculando cotización...</p>}
          {quoteMutation.isError && <p className="error">{errorMessage}</p>}
          {quoteMutation.data && <QuoteResult quote={quoteMutation.data} />}
        </section>
      </div>
    </>
  );
}
