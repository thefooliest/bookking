import type { ApiErrorBody } from '@bookking/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasBody = init?.body !== undefined && init?.body !== null;

  if (hasBody && !headers.has('content-type') && !headers.has('Content-Type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  const body = (await response.json().catch(() => null)) as ApiErrorBody | T | null;

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      errorBody?.message ?? 'No fue posible completar la solicitud',
      errorBody?.details
    );
  }

  if (body === null) {
    return undefined as T;
  }

  return body as T;
}
