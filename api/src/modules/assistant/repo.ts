import type { AssistantMessage, AssistantMessageRole } from '@bookking/shared';
import { pool } from '../../db/pool.js';

type ConversationRow = {
  id: string;
  customer_id: number;
  booking_id: number | null;
  context: unknown;
  created_at: Date;
  updated_at: Date;
};

type MessageRow = {
  id: string;
  role: AssistantMessageRole;
  content: string;
  created_at: Date;
};

export type ConversationState = {
  id: string;
  bookingId: number | null;
  context: unknown;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapMessage(row: MessageRow): AssistantMessage {
  return {
    id: Number(row.id),
    role: row.role,
    content: row.content,
    createdAt: toIso(row.created_at) as string
  };
}

export async function ensureConversation(customerId: number): Promise<ConversationState> {
  const result = await pool.query<ConversationRow>(
    `INSERT INTO assistant_conversations (customer_id)
     VALUES ($1)
     ON CONFLICT (customer_id)
     DO UPDATE SET updated_at = assistant_conversations.updated_at
     RETURNING id, customer_id, booking_id, context, created_at, updated_at`,
    [customerId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('No se pudo crear la conversación');
  }

  return {
    id: row.id,
    bookingId: row.booking_id,
    context: row.context
  };
}

export async function listMessages(conversationId: string): Promise<AssistantMessage[]> {
  const result = await pool.query<MessageRow>(
    `SELECT id, role, content, created_at
     FROM assistant_messages
     WHERE conversation_id = $1
     ORDER BY id ASC`,
    [conversationId]
  );

  return result.rows.map(mapMessage);
}

export async function appendMessage(
  conversationId: string,
  role: AssistantMessageRole,
  content: string
): Promise<AssistantMessage> {
  const result = await pool.query<MessageRow>(
    `INSERT INTO assistant_messages (conversation_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING id, role, content, created_at`,
    [conversationId, role, content]
  );

  await pool.query(
    'UPDATE assistant_conversations SET updated_at = now() WHERE id = $1',
    [conversationId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('No se pudo guardar el mensaje');
  }
  return mapMessage(row);
}

export async function deleteMessage(id: number): Promise<void> {
  await pool.query('DELETE FROM assistant_messages WHERE id = $1', [id]);
}

export async function setConversationBooking(
  conversationId: string,
  bookingId: number
): Promise<void> {
  await pool.query(
    `UPDATE assistant_conversations
     SET booking_id = $2, updated_at = now()
     WHERE id = $1`,
    [conversationId, bookingId]
  );
}

export async function setConversationContext(
  conversationId: string,
  context: unknown
): Promise<void> {
  await pool.query(
    `UPDATE assistant_conversations
     SET context = $2, updated_at = now()
     WHERE id = $1`,
    [conversationId, JSON.stringify(context)]
  );
}

export async function resetConversation(customerId: number): Promise<void> {
  await pool.query('DELETE FROM assistant_conversations WHERE customer_id = $1', [
    customerId
  ]);
}
