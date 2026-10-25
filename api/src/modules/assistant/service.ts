import type {
  AssistantConversation,
  AssistantMessage,
  AuthUser,
  BookingDetail
} from '@bookking/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { findUserById } from '../auth/repo.js';
import { getBooking } from '../bookings/service.js';
import { nowInAppZone } from './dates.js';
import { runMockAssistant } from './mock.js';
import { buildAssistantPrompt } from './prompt.js';
import {
  openRouterChat,
  type ProviderMessage
} from './provider.js';
import {
  appendMessage,
  deleteMessage,
  ensureConversation,
  listMessages,
  resetConversation,
  setConversationContext
} from './repo.js';
import { assistantReplySchema } from './schemas.js';
import { executeTool } from './tools.js';

async function loadBooking(
  bookingId: number | null,
  customerId: number
): Promise<BookingDetail | null> {
  if (bookingId === null) {
    return null;
  }

  try {
    return await getBooking(bookingId, customerId, 'customer');
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function conversationFor(
  customerId: number,
  messages: AssistantMessage[]
): Promise<AssistantConversation> {
  const current = await ensureConversation(customerId);
  const booking = await loadBooking(current.bookingId, customerId);

  return {
    provider: env.AI_PROVIDER,
    messages,
    booking
  };
}

export async function getAssistantConversation(
  customerId: number
): Promise<AssistantConversation> {
  const state = await ensureConversation(customerId);
  const messages = await listMessages(state.id);
  return conversationFor(customerId, messages);
}

async function requireUser(userId: number): Promise<AuthUser> {
  const user = await findUserById(userId);
  if (!user) {
    throw new AppError(401, 'unauthorized', 'Debes iniciar sesión.');
  }
  return user;
}

function validateReply(content: string): string {
  const parsed = assistantReplySchema.safeParse(content);
  if (!parsed.success) {
    throw new AppError(
      502,
      'ai_invalid_response',
      'El asistente generó una respuesta inválida. Intenta de nuevo.'
    );
  }
  return parsed.data;
}

async function runOpenRouter(input: {
  user: AuthUser;
  conversationId: string;
  booking: BookingDetail | null;
  messages: AssistantMessage[];
}): Promise<string> {
  const chat: ProviderMessage[] = [
    {
      role: 'system',
      content: buildAssistantPrompt({
        user: input.user,
        booking: input.booking,
        now: nowInAppZone()
      })
    },
    ...input.messages.slice(-20).map(
      (message): ProviderMessage => ({
        role: message.role,
        content: message.content
      })
    )
  ];

  const toolContext = {
    conversationId: input.conversationId,
    userId: input.user.id,
    bookingId: input.booking?.id ?? null
  };

  for (let step = 0; step < 6; step += 1) {
    const message = await openRouterChat(chat);

    if (message.tool_calls.length > 0) {
      chat.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.tool_calls
      });

      for (const call of message.tool_calls) {
        const result = await executeTool(
          call.function.name,
          call.function.arguments,
          toolContext
        );
        chat.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
      continue;
    }

    return validateReply(message.content ?? '');
  }

  throw new AppError(
    502,
    'ai_tool_loop',
    'El asistente no pudo completar la respuesta. Intenta de nuevo.'
  );
}

export async function sendAssistantMessage(
  userId: number,
  content: string
): Promise<AssistantConversation> {
  const user = await requireUser(userId);
  const state = await ensureConversation(userId);
  const booking = await loadBooking(state.bookingId, userId);
  const userMessage = await appendMessage(state.id, 'user', content);

  try {
    const messages = await listMessages(state.id);
    let reply: string;

    if (env.AI_PROVIDER === 'mock') {
      const result = await runMockAssistant({
        user,
        messages,
        booking,
        context: state.context,
        conversationId: state.id
      });
      await setConversationContext(state.id, result.context);
      reply = result.reply;
    } else {
      reply = await runOpenRouter({
        user,
        conversationId: state.id,
        booking,
        messages
      });
    }

    const validReply = validateReply(reply);
    await appendMessage(state.id, 'assistant', validReply);
  } catch (error) {
    await deleteMessage(userMessage.id);
    throw error;
  }

  return getAssistantConversation(userId);
}

export async function resetAssistantConversation(userId: number): Promise<void> {
  await resetConversation(userId);
}
