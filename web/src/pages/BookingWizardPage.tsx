import {
  EXTRA_SERVICES,
  type BookingDetail,
  type BookingExtraInput,
  type BookingUpdateRequest,
  type CustomerDetails,
  type QuoteResponse,
  type Room
} from '@bookking/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  formatCurrency,
  formatDateTime,
  formatLongDate,
  statusLabels,
  today
} from '../lib/format';

const durationOptions = Array.from({ length: 19 }, (_, index) => 1 + index * 0.5);

type CustomerForm = {
  fullName: string;
  email: string;
  phone: string;
  company: string;
};

type ScheduleForm = {
  roomId: string;
  date: string;
  startTime: string;
  durationHours: number;
};

type ExtrasForm = {
  projector: boolean;
  projectorQty: number;
  coffee: boolean;
  coffeeQty: number;
};

type WizardLocationState = {
  quote?: QuoteResponse;
};

function emptyCustomer(): CustomerForm {
  return { fullName: '', email: '', phone: '', company: '' };
}

function customerFromBooking(booking: BookingDetail): CustomerForm {
  const customer = booking.draft.customer;
  if (!customer) {
    return emptyCustomer();
  }

  return {
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone,
    company: customer.company ?? ''
  };
}

function scheduleFromQuote(quote: QuoteResponse): ScheduleForm {
  return {
    roomId: String(quote.room.id),
    date: quote.date,
    startTime: quote.startTime,
    durationHours: quote.durationHours
  };
}

function extrasFromBooking(booking: BookingDetail): ExtrasForm {
  const projector = booking.draft.extras.find((extra) => extra.code === 'projector');
  const coffee = booking.draft.extras.find((extra) => extra.code === 'coffee');

  return {
    projector: Boolean(projector),
    projectorQty: projector?.quantity ?? 1,
    coffee: Boolean(coffee),
    coffeeQty: coffee?.quantity ?? 1
  };
}

function extrasPayload(extras: ExtrasForm): BookingExtraInput[] {
  const payload: BookingExtraInput[] = [];

  if (extras.projector) {
    payload.push({ code: 'projector', quantity: extras.projectorQty });
  }
  if (extras.coffee) {
    payload.push({ code: 'coffee', quantity: extras.coffeeQty });
  }

  return payload;
}

function extrasEstimate(extras: ExtrasForm): number {
  const projectorPrice =
    EXTRA_SERVICES.find((service) => service.code === 'projector')?.unitPrice ?? 0;
  const coffeePrice =
    EXTRA_SERVICES.find((service) => service.code === 'coffee')?.unitPrice ?? 0;

  return (
    (extras.projector ? projectorPrice * extras.projectorQty : 0) +
    (extras.coffee ? coffeePrice * extras.coffeeQty : 0)
  );
}

function quoteFromError(error: unknown): QuoteResponse | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }

  const details = error.details as Partial<QuoteResponse> | null;
  if (details && typeof details.available === 'boolean' && details.reason !== undefined) {
    return details as QuoteResponse;
  }

  return null;
}

function Stepper({
  activeStep,
  maxStep,
  onSelect
}: {
  activeStep: number;
  maxStep: number;
  onSelect: (step: number) => void;
}) {
  const labels = ['Datos del cliente', 'Sala y horario', 'Servicios'];

  return (
    <ol className="stepper">
      {labels.map((label, index) => {
        const step = index + 1;
        const isActive = step === activeStep;
        const canSelect = step <= maxStep && !isActive;

        return (
          <li key={label} className={isActive ? 'active' : step < activeStep ? 'done' : ''}>
            <button
              type="button"
              className="step-button"
              disabled={!canSelect}
              onClick={() => onSelect(step)}
            >
              <span className="step-number">{step}</span>
              <span>{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function BookingStatusView({ booking }: { booking: BookingDetail }) {
  const isConfirmed = booking.status === 'confirmed';
  const isCancelled = booking.status === 'cancelled';

  return (
    <section className="card status-card">
      <p className="eyebrow">Reserva #{booking.id}</p>
      <h1>
        {isConfirmed && 'Tu reserva está confirmada'}
        {isCancelled && 'La reserva fue cancelada'}
        {booking.status === 'completed' && 'La reserva fue completada'}
      </h1>
      <span className={`status-pill ${booking.status}`}>{statusLabels[booking.status]}</span>

      <dl className="detail-list">
        <div>
          <dt>Sala</dt>
          <dd>{booking.room?.name ?? 'Sin sala'}</dd>
        </div>
        <div>
          <dt>Horario</dt>
          <dd>
            {formatDateTime(booking.startsAt)} a {formatDateTime(booking.endsAt)}
          </dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{booking.total === null ? 'Pendiente' : formatCurrency(booking.total)}</dd>
        </div>
        <div>
          <dt>Cliente</dt>
          <dd>{booking.draft.customer?.fullName ?? booking.customer.fullName}</dd>
        </div>
      </dl>

      {booking.services.length > 0 && (
        <div className="service-summary">
          <h2>Servicios adicionales</h2>
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

      {isCancelled && booking.cancellationReason && (
        <p className="reason">Motivo: {booking.cancellationReason}</p>
      )}

      <div className="actions">
        <Link className="button" to="/mis-reservas">
          Ver mis reservas
        </Link>
        <Link className="button secondary" to="/cotizar">
          Hacer otra reserva
        </Link>
      </div>
    </section>
  );
}

export function BookingWizardPage() {
  const { id } = useParams();
  const bookingId = id ? Number(id) : null;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const quoteState = (location.state as WizardLocationState | null)?.quote ?? null;

  const [customer, setCustomer] = useState<CustomerForm>(() => ({
    ...emptyCustomer(),
    fullName: user?.fullName ?? '',
    email: user?.email ?? ''
  }));
  const [schedule, setSchedule] = useState<ScheduleForm>(() =>
    quoteState
      ? scheduleFromQuote(quoteState)
      : {
          roomId: '',
          date: today(),
          startTime: '09:00',
          durationHours: 1
        }
  );
  const [extras, setExtras] = useState<ExtrasForm>({
    projector: false,
    projectorQty: 1,
    coffee: false,
    coffeeQty: 1
  });
  const [notes, setNotes] = useState('');
  const [activeStep, setActiveStep] = useState(1);
  const [createdId, setCreatedId] = useState<number | null>(null);

  const effectiveId = bookingId ?? createdId;

  const roomsQuery = useQuery({
    queryKey: ['rooms'],
    queryFn: () => apiFetch<Room[]>('/api/rooms')
  });

  const bookingQuery = useQuery({
    queryKey: ['booking', String(bookingId)],
    queryFn: () => apiFetch<BookingDetail>(`/api/bookings/${bookingId}`),
    enabled: bookingId !== null,
    retry: false
  });

  const booking = bookingQuery.data ?? null;

  useEffect(() => {
    const firstRoom = roomsQuery.data?.[0];
    if (firstRoom && schedule.roomId === '') {
      setSchedule((current) => ({ ...current, roomId: String(firstRoom.id) }));
    }
  }, [roomsQuery.data, schedule.roomId]);

  useEffect(() => {
    if (!booking) {
      return;
    }

    setCustomer(customerFromBooking(booking));

    if (booking.draft.schedule) {
      setSchedule({
        roomId: String(booking.draft.schedule.roomId),
        date: booking.draft.schedule.date,
        startTime: booking.draft.schedule.startTime,
        durationHours: booking.draft.schedule.durationHours
      });
    } else if (quoteState) {
      setSchedule(scheduleFromQuote(quoteState));
    }

    setExtras(extrasFromBooking(booking));
    setNotes(booking.draft.notes ?? '');
    setActiveStep(
      booking.status === 'draft' ? Math.min(Math.max(booking.currentStep, 1), 3) : 3
    );
  }, [booking, quoteState]);

  const saveMutation = useMutation({
    mutationFn: async (variables: {
      step: number;
      input: BookingUpdateRequest;
      customer?: CustomerDetails;
    }) => {
      let idToUse = effectiveId;

      if (!idToUse) {
        const created = await apiFetch<BookingDetail>('/api/bookings', {
          method: 'POST',
          body: JSON.stringify({ customer: variables.customer })
        });
        idToUse = created.id;
        setCreatedId(created.id);
      }

      return apiFetch<BookingDetail>(`/api/bookings/${idToUse}`, {
        method: 'PATCH',
        body: JSON.stringify(variables.input)
      });
    },
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(['booking', String(updated.id)], updated);
      if (!bookingId) {
        navigate(`/reservar/${updated.id}`, { replace: true, state: location.state });
      }
      setActiveStep(Math.min(variables.step + 1, 3));
    }
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveId) {
        throw new Error('La reserva aún no se ha guardado.');
      }

      const saved = await apiFetch<BookingDetail>(`/api/bookings/${effectiveId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          currentStep: 3,
          extras: extrasPayload(extras),
          notes: notes.trim() ? notes.trim() : null
        } satisfies BookingUpdateRequest)
      });
      queryClient.setQueryData(['booking', String(saved.id)], saved);

      return apiFetch<BookingDetail>(`/api/bookings/${effectiveId}/confirm`, {
        method: 'POST'
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['booking', String(updated.id)], updated);
      setActiveStep(3);
    }
  });

  function resetErrors(): void {
    saveMutation.reset();
    confirmMutation.reset();
  }

  function goToStep(step: number): void {
    resetErrors();
    setActiveStep(step);
  }

  function toCustomerDetails(): CustomerDetails {
    return {
      fullName: customer.fullName.trim(),
      email: customer.email.trim(),
      phone: customer.phone.trim(),
      company: customer.company.trim() ? customer.company.trim() : null
    };
  }

  function handleCustomerSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const details = toCustomerDetails();

    saveMutation.mutate({
      step: 1,
      customer: details,
      input: {
        customer: details,
        currentStep: 2
      }
    });
  }

  function handleScheduleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    saveMutation.mutate({
      step: 2,
      input: {
        currentStep: 3,
        schedule: {
          roomId: Number(schedule.roomId),
          date: schedule.date,
          startTime: schedule.startTime,
          durationHours: schedule.durationHours
        }
      }
    });
  }

  function handleExtrasSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    saveMutation.mutate({
      step: 3,
      input: {
        currentStep: 3,
        extras: extrasPayload(extras),
        notes: notes.trim() ? notes.trim() : null
      }
    });
  }

  function handleConfirm(): void {
    resetErrors();
    confirmMutation.mutate();
  }

  function useNextSlot(startTime: string): void {
    setSchedule((current) => ({ ...current, startTime }));
    resetErrors();
  }

  if (bookingQuery.isPending && bookingId !== null) {
    return <p className="empty-state">Cargando tu reserva...</p>;
  }

  if (bookingQuery.isError) {
    return (
      <section className="card">
        <h1>No encontramos esa reserva</h1>
        <p className="lede">Revisa el enlace o vuelve a tus reservas.</p>
        <Link className="button" to="/mis-reservas">
          Volver a mis reservas
        </Link>
      </section>
    );
  }

  if (booking && booking.status !== 'draft') {
    return <BookingStatusView booking={booking} />;
  }

  const saveError = saveMutation.error;
  const slotError = quoteFromError(saveError);
  const saveErrorMessage =
    saveError instanceof ApiError
      ? saveError.message
      : saveError
        ? 'No fue posible guardar la reserva.'
        : null;
  const confirmErrorMessage =
    confirmMutation.error instanceof ApiError
      ? confirmMutation.error.message
      : confirmMutation.error
        ? 'No fue posible confirmar la reserva.'
        : null;

  const savedQuote = booking?.quote ?? quoteState;
  const servicesEstimate = extrasEstimate(extras);
  const estimatedTotal = savedQuote ? savedQuote.total + servicesEstimate : null;
  const maxStep = Math.max(booking?.currentStep ?? 1, activeStep);
  const currentRoom = roomsQuery.data?.find((room) => String(room.id) === schedule.roomId);
  const isSaving = saveMutation.isPending;
  const isConfirming = confirmMutation.isPending;

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Reserva por pasos</p>
        <h1>Reserva tu sala</h1>
        <p className="lede">
          Cada paso queda guardado como borrador. Puedes cerrar el navegador y continuar
          desde “Mis reservas”.
        </p>
      </section>

      <Stepper activeStep={activeStep} maxStep={maxStep} onSelect={goToStep} />

      <div className="wizard-layout">
        <section className="card form-card">
          {activeStep === 1 && (
            <form onSubmit={handleCustomerSubmit}>
              <div className="form-heading">
                <p className="eyebrow">Paso 1</p>
                <h2>Datos del cliente</h2>
              </div>

              <label className="field">
                <span>Nombre completo</span>
                <input
                  value={customer.fullName}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, fullName: event.target.value }))
                  }
                  autoComplete="name"
                  required
                />
              </label>

              <label className="field">
                <span>Correo</span>
                <input
                  type="email"
                  value={customer.email}
                  onChange={(event) =>
                    setCustomer((current) => ({ ...current, email: event.target.value }))
                  }
                  autoComplete="email"
                  required
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Teléfono</span>
                  <input
                    value={customer.phone}
                    onChange={(event) =>
                      setCustomer((current) => ({ ...current, phone: event.target.value }))
                    }
                    autoComplete="tel"
                    required
                  />
                </label>

                <label className="field">
                  <span>Empresa (opcional)</span>
                  <input
                    value={customer.company}
                    onChange={(event) =>
                      setCustomer((current) => ({ ...current, company: event.target.value }))
                    }
                    autoComplete="organization"
                  />
                </label>
              </div>

              {saveErrorMessage && <p className="error">{saveErrorMessage}</p>}

              <button className="button" type="submit" disabled={isSaving}>
                {isSaving ? 'Guardando...' : 'Guardar y continuar'}
              </button>
            </form>
          )}

          {activeStep === 2 && (
            <form onSubmit={handleScheduleSubmit}>
              <div className="form-heading">
                <p className="eyebrow">Paso 2</p>
                <h2>Sala y horario</h2>
              </div>

              <label className="field">
                <span>Sala</span>
                <select
                  value={schedule.roomId}
                  onChange={(event) =>
                    setSchedule((current) => ({ ...current, roomId: event.target.value }))
                  }
                  required
                >
                  {roomsQuery.isPending && <option value="">Cargando salas...</option>}
                  {roomsQuery.data?.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name} · {formatCurrency(room.hourlyRate)}/hora
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Fecha</span>
                <input
                  type="date"
                  value={schedule.date}
                  onChange={(event) =>
                    setSchedule((current) => ({ ...current, date: event.target.value }))
                  }
                  required
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Hora de inicio</span>
                  <input
                    type="time"
                    step={1800}
                    value={schedule.startTime}
                    onChange={(event) =>
                      setSchedule((current) => ({
                        ...current,
                        startTime: event.target.value
                      }))
                    }
                    required
                  />
                </label>

                <label className="field">
                  <span>Duración</span>
                  <select
                    value={schedule.durationHours}
                    onChange={(event) =>
                      setSchedule((current) => ({
                        ...current,
                        durationHours: Number(event.target.value)
                      }))
                    }
                  >
                    {durationOptions.map((hours) => (
                      <option key={hours} value={hours}>
                        {hours} {hours === 1 ? 'hora' : 'horas'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {slotError && (
                <div className="reason">
                  <p>{slotError.reason}</p>
                  {slotError.nextAvailable && (
                    <button
                      className="inline-action"
                      type="button"
                      onClick={() => useNextSlot(slotError.nextAvailable?.startTime ?? '')}
                    >
                      Usar {slotError.nextAvailable.startTime} a {slotError.nextAvailable.endTime}
                    </button>
                  )}
                </div>
              )}
              {!slotError && saveErrorMessage && <p className="error">{saveErrorMessage}</p>}

              <div className="actions">
                <button className="button secondary" type="button" onClick={() => goToStep(1)}>
                  Volver
                </button>
                <button className="button" type="submit" disabled={isSaving}>
                  {isSaving ? 'Guardando...' : 'Guardar y continuar'}
                </button>
              </div>

              <p className="hint">
                Horario de atención: lunes a sábado, 07:00 a 21:00. Domingos cerrado.
              </p>
            </form>
          )}

          {activeStep === 3 && (
            <form onSubmit={handleExtrasSubmit}>
              <div className="form-heading">
                <p className="eyebrow">Paso 3</p>
                <h2>Servicios adicionales</h2>
              </div>

              <div className="extra-list">
                {EXTRA_SERVICES.map((service) => {
                  const checked =
                    service.code === 'projector' ? extras.projector : extras.coffee;
                  const quantity =
                    service.code === 'projector' ? extras.projectorQty : extras.coffeeQty;

                  return (
                    <div className="extra-row" key={service.code}>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            if (service.code === 'projector') {
                              setExtras((current) => ({
                                ...current,
                                projector: event.target.checked
                              }));
                            } else {
                              setExtras((current) => ({
                                ...current,
                                coffee: event.target.checked
                              }));
                            }
                          }}
                        />
                        <span>
                          <strong>{service.label}</strong>
                          <small>{formatCurrency(service.unitPrice)} c/u</small>
                        </span>
                      </label>

                      <label className="field quantity-field">
                        <span>Cantidad</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={quantity}
                          disabled={!checked}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (service.code === 'projector') {
                              setExtras((current) => ({
                                ...current,
                                projectorQty: next
                              }));
                            } else {
                              setExtras((current) => ({
                                ...current,
                                coffeeQty: next
                              }));
                            }
                          }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>

              <label className="field">
                <span>Notas para el coworking (opcional)</span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Ej. necesitamos sillas adicionales"
                />
              </label>

              {saveErrorMessage && <p className="error">{saveErrorMessage}</p>}
              {confirmErrorMessage && (
                <div className="reason">
                  <p>{confirmErrorMessage}</p>
                  <button
                    className="inline-action"
                    type="button"
                    onClick={() => goToStep(2)}
                  >
                    Revisar sala y horario
                  </button>
                </div>
              )}

              <div className="actions">
                <button className="button secondary" type="button" onClick={() => goToStep(2)}>
                  Volver
                </button>
                <button className="button secondary" type="submit" disabled={isSaving || isConfirming}>
                  {isSaving ? 'Guardando...' : 'Guardar borrador'}
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={handleConfirm}
                  disabled={isSaving || isConfirming || !effectiveId}
                >
                  {isConfirming ? 'Confirmando...' : 'Confirmar reserva'}
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className="card summary-card">
          <p className="eyebrow">Resumen</p>
          <h2>{currentRoom?.name ?? 'Sala por elegir'}</h2>

          <p className="muted">
            {formatLongDate(schedule.date)} · {schedule.startTime} · {schedule.durationHours}{' '}
            h
          </p>

          {savedQuote ? (
            <dl className="breakdown">
              <div className="breakdown-row">
                <dt>Tarifa base</dt>
                <dd>{formatCurrency(savedQuote.base)}</dd>
              </div>
              <div className="breakdown-row">
                <dt>Descuento ({savedQuote.discountPercent}%)</dt>
                <dd>-{formatCurrency(savedQuote.discount)}</dd>
              </div>
              <div className="breakdown-row">
                <dt>Recargo sábado ({savedQuote.surchargePercent}%)</dt>
                <dd>+{formatCurrency(savedQuote.surcharge)}</dd>
              </div>
              <div className="breakdown-row">
                <dt>Servicios</dt>
                <dd>{formatCurrency(servicesEstimate)}</dd>
              </div>
              <div className="breakdown-row total">
                <dt>Total</dt>
                <dd>{estimatedTotal === null ? '—' : formatCurrency(estimatedTotal)}</dd>
              </div>
            </dl>
          ) : (
            <p className="empty-state">
              La cotización se guarda cuando eliges la sala y el horario.
            </p>
          )}

          {booking && (
            <p className="hint">
              Borrador #{booking.id} · {statusLabels[booking.status]}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
