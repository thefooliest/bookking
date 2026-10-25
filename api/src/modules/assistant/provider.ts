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

export async function openRouterChat(
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
      'x-title': 'Bookking'
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages,
      tools: assistantTools,
      tool_choice: 'auto',
      temperature: 0.2
    }),
    signal: AbortSignal.timeout(45_000)
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AppError(
      502,
      'ai_provider_error',
      'El proveedor de IA no respondió correctamente. Intenta de nuevo.'
    );
  }

  const parsed = completionSchema.safeParse(body);
  if (!parsed.success) {
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
