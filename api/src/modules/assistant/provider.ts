import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { assistantTools } from './tools.js';

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function').optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .transform((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
  })
});

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(toolCallSchema).optional()
        })
      })
    )
    .min(1)
});

export type ProviderToolCall = z.infer<typeof toolCallSchema>;

export type ProviderMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ProviderToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ProviderAssistantMessage = {
  content: string | null;
  tool_calls: ProviderToolCall[];
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openRouterChatOnce(
  messages: ProviderMessage[]
): Promise<ProviderAssistantMessage> {
  if (!env.OPENROUTER_API_KEY) {
    throw new AppError(
      503,
      'ai_not_configured',
      'El asistente de IA no está configurado. Define OPENROUTER_API_KEY.'
    );
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      'x-title': 'Bookking',
      'HTTP-Referer': 'http://localhost:3000'
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages,
      tools: assistantTools,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 1024
    }),
    signal: AbortSignal.timeout(90_000)
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = body as { error?: { message?: string } } | null;
    const providerMessage =
      errorBody?.error?.message ??
      'El proveedor de IA no respondió correctamente. Intenta de nuevo.';

    console.error('[openrouter] error', {
      status: response.status,
      model: env.OPENROUTER_MODEL,
      message: providerMessage
    });

    throw new AppError(502, 'ai_provider_error', providerMessage);
  }

  const parsed = completionSchema.safeParse(body);
  if (!parsed.success) {
    console.error('[openrouter] invalid response', {
      model: env.OPENROUTER_MODEL,
      body
    });
    throw new AppError(
      502,
      'ai_invalid_response',
      'El proveedor de IA devolvió una respuesta con un formato inválido.'
    );
  }

  const message = parsed.data.choices[0]?.message;
  if (!message) {
    throw new AppError(502, 'ai_empty_response', 'El asistente no generó una respuesta.');
  }

  return {
    content: message.content ?? null,
    tool_calls: message.tool_calls ?? []
  };
}

export async function openRouterChat(
  messages: ProviderMessage[]
): Promise<ProviderAssistantMessage> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await openRouterChatOnce(messages);
    } catch (error) {
      lastError = error;

      if (error instanceof AppError && error.code === 'ai_provider_error') {
        const message = error.message.toLowerCase();
        if (
          message.includes('429') ||
          message.includes('rate') ||
          message.includes('temporarily')
        ) {
          if (attempt < 2) {
            const delay = (attempt + 1) * 2000;
            console.warn(`[openrouter] rate limited, retrying in ${delay}ms`, {
              attempt: attempt + 1,
              model: env.OPENROUTER_MODEL
            });
            await sleep(delay);
            continue;
          }
        }
      }

      throw error;
    }
  }

  throw lastError as Error;
}
