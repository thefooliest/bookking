import type {
  AssistantConversation,
  BookingDetail
} from '@bookking/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiFetch } from '../api/client';
import {
  formatCurrency,
  formatDateTime,
  statusLabels
} from '../lib/format';

const suggestions = [
  'Necesito una sala para 6 personas el sábado en la mañana con proyector',
  'Busco una sala grande para 10 personas mañana en la tarde',
  'Quiero reservar la sala pequeña el viernes por 3 horas'
];

function AssistantBookingCard({ booking }: { booking: BookingDetail }) {
  const isDraft = booking.status === 'draft';

  return (
    <aside className="assistant-booking">
      <p className="eyebrow">{isDraft ? 'Borrador listo' : 'Reserva del chat'}</p>
      <h2>{booking.room?.name ?? 'Reserva'}</h2>
      <span className={`status-pill ${booking.status}`}>{statusLabels[booking.status]}</span>
      <dl className="detail-list compact">
        <div>
          <dt>Horario</dt>
          <dd>{formatDateTime(booking.startsAt)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{booking.total === null ? 'Pendiente' : formatCurrency(booking.total)}</dd>
        </div>
      </dl>
      <Link className="button" to={`/reservar/${booking.id}`}>
        {isDraft ? 'Revisar y confirmar' : 'Ver reserva'}
      </Link>
      <p className="hint">
        La confirmación siempre se hace desde la app, nunca desde el chat.
      </p>
    </aside>
  );
}

export function AssistantPage() {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const conversationQuery = useQuery({
    queryKey: ['assistant'],
    queryFn: () => apiFetch<AssistantConversation>('/api/assistant')
  });

  const sendMutation = useMutation({
    mutationFn: (message: string) =>
      apiFetch<AssistantConversation>('/api/assistant/messages', {
        method: 'POST',
        body: JSON.stringify({ content: message })
      }),
    onSuccess: (conversation) => {
      queryClient.setQueryData(['assistant'], conversation);
      setContent('');
    }
  });

  const resetMutation = useMutation({
    mutationFn: () =>
      apiFetch<null>('/api/assistant/reset', {
        method: 'POST'
      }),
    onSuccess: () => {
      queryClient.setQueryData<AssistantConversation>(['assistant'], (current) => ({
        provider: current?.provider ?? 'mock',
        messages: [],
        booking: null
      }));
      sendMutation.reset();
    }
  });

  const conversation = conversationQuery.data;
  const messages = conversation?.messages ?? [];

  useEffect(() => {
    const element = messagesRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages.length, sendMutation.isPending]);

  function sendMessage(message: string): void {
    const trimmed = message.trim();
    if (!trimmed || sendMutation.isPending || trimmed.length > 1000) {
      return;
    }
    sendMutation.mutate(trimmed);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    sendMessage(content);
  }

  const errorMessage =
    sendMutation.error instanceof ApiError
      ? sendMutation.error.message
      : sendMutation.error
        ? 'No fue posible enviar el mensaje.'
        : null;

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">Asistente de reservas</p>
        <h1>Reserva conversando</h1>
        <p className="lede">
          Cuéntale al asistente qué necesitas. Consulta disponibilidad real, arma el
          borrador y confírmalo tú mismo con el botón de la app.
        </p>
      </section>

      <div className="assistant-layout">
        <section className="card assistant-card">
          <header className="assistant-header">
            <div>
              <h2>Chat de reservas</h2>
              <p className="hint">
                {conversation?.provider === 'openrouter'
                  ? 'IA conectada a OpenRouter'
                  : 'Modo local de demostración (sin API key)'}
              </p>
            </div>
            <button
              className="link-button"
              type="button"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending || messages.length === 0}
            >
              Nueva conversación
            </button>
          </header>

          <div className="assistant-messages" ref={messagesRef}>
            {conversationQuery.isPending && (
              <p className="empty-state">Cargando la conversación...</p>
            )}
            {conversationQuery.isError && (
              <p className="error">No fue posible cargar la conversación.</p>
            )}

            {conversation && messages.length === 0 && (
              <div className="assistant-welcome">
                <p>
                  Hola. Puedo ayudarte a encontrar sala, revisar el precio y dejar la
                  reserva en borrador. ¿Qué necesitas?
                </p>
                <div className="suggestion-list">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="suggestion"
                      onClick={() => sendMessage(suggestion)}
                      disabled={sendMutation.isPending}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <article
                key={message.id}
                className={`chat-message ${message.role}`}
              >
                <span className="chat-author">
                  {message.role === 'user' ? 'Tú' : 'Asistente'}
                </span>
                <p>{message.content}</p>
              </article>
            ))}

            {sendMutation.isPending && (
              <article className="chat-message assistant pending">
                <span className="chat-author">Asistente</span>
                <p>Revisando salas y disponibilidad...</p>
              </article>
            )}
          </div>

          {errorMessage && <p className="error">{errorMessage}</p>}

          <form className="assistant-composer" onSubmit={handleSubmit}>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Ej. necesito una sala para 6 personas el sábado en la mañana"
              rows={3}
              maxLength={1000}
              disabled={sendMutation.isPending}
            />
            <div className="composer-actions">
              <span className="hint">{content.length}/1000</span>
              <button
                className="button"
                type="submit"
                disabled={sendMutation.isPending || content.trim().length === 0}
              >
                {sendMutation.isPending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </form>
        </section>

        <div className="assistant-side">
          {conversation?.booking ? (
            <AssistantBookingCard booking={conversation.booking} />
          ) : (
            <aside className="assistant-booking muted">
              <p className="eyebrow">Sin borrador todavía</p>
              <h2>Cuéntame tu plan</h2>
              <p className="hint">
                Cuando tengamos sala, fecha, hora, duración y tu teléfono, dejaré la
                reserva lista para que la confirmes.
              </p>
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
