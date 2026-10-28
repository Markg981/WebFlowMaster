import { MutationCache, QueryClient, QueryFunction } from '@tanstack/react-query';
import i18n from 'i18next';
import { clientLogger, setCurrentCorrelationId } from '@/observability/logger';
import { getSessionId, newCorrelationId } from '@/observability/session';
import { toast } from '@/hooks/use-toast';

/**
 * An error a caller can act on, not just display.
 *
 * The message stays `"<status>: <body>"`, which is what several toasts already show. What is
 * new is that the status and the parsed body ride along, so a caller that wants to treat one
 * status differently — a 409 offering to overwrite, say — does not have to pick the number
 * back out of a string and hope the format never changes.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * What to show a person for a failed request: the server's own sentence when it sent one.
 * ApiError.message is "400: {\"message\":...}", meant for logs; pages that put it on screen
 * showed the JSON to whoever mistyped a password.
 */
/** First readable "field: message" out of a zod flatten ({formErrors, fieldErrors}) or zod 4 tree ({errors, properties}). */
export function validationMessage(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const d = details as Record<string, unknown>;
  const first = (v: unknown): string | undefined =>
    Array.isArray(v) ? v.find((x) => typeof x === 'string' && x) : undefined;
  if (d.fieldErrors && typeof d.fieldErrors === 'object') {
    for (const [field, msgs] of Object.entries(d.fieldErrors)) {
      const m = first(msgs);
      if (m) return `${field}: ${m}`;
    }
  }
  const form = first(d.formErrors) ?? first(d.errors);
  if (d.properties && typeof d.properties === 'object') {
    for (const [field, sub] of Object.entries(d.properties)) {
      const m = first((sub as { errors?: unknown } | undefined)?.errors);
      if (m) return `${field}: ${m}`;
    }
  }
  return form;
}

/**
 * What to show a person for a failed request: the field-level validation error when the server
 * sent one, else its own sentence. ApiError.message is "400: {\"message\":...}", meant for logs;
 * pages that put it on screen showed the JSON to whoever mistyped a password.
 */
export function errorMessage(error: unknown): string {
  let body: unknown;
  if (error instanceof ApiError) body = error.body;
  else if (error instanceof Error) {
    const m = /^\d{3}: (\{[\s\S]*\})$/.exec(error.message);
    if (m) {
      try {
        body = JSON.parse(m[1]);
      } catch {
        /* not JSON */
      }
    }
  }
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown; details?: unknown };
    const v = validationMessage(b.details) ?? validationMessage(b);
    if (v) return v;
    if (typeof b.message === 'string' && b.message) return b.message;
    if (typeof b.error === 'string' && b.error) return b.error;
  }
  return error instanceof Error ? error.message : String(error);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text; // not JSON; the message below still carries it
    }
    throw new ApiError(res.status, body, `${res.status}: ${text}`);
  }
}

/**
 * Correlation headers let a UI action and the server work it triggers share one id.
 *
 * The session header is deliberately `X-Wfm-Session-Id`, not the conventional
 * `X-Session-Id`: the server's incident tap refuses to capture the latter, because under
 * that name a proxy or another client could be carrying a real session credential. Ours
 * is a random per-tab id and safe to record.
 */
function tracingHeaders(correlationId: string): Record<string, string> {
  return { 'X-Correlation-Id': correlationId, 'X-Wfm-Session-Id': getSessionId() };
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const correlationId = newCorrelationId();
  setCurrentCorrelationId(correlationId);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...tracingHeaders(correlationId),
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });

    clientLogger.http(`${method} ${url}`, {
      status: res.status,
      durationMs: Date.now() - startedAt,
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    clientLogger.error(`${method} ${url} failed`, {
      durationMs: Date.now() - startedAt,
      message: (error as Error).message,
    });
    throw error;
  } finally {
    setCurrentCorrelationId(undefined);
  }
}

type UnauthorizedBehavior = 'returnNull' | 'throw';
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    const correlationId = newCorrelationId();
    setCurrentCorrelationId(correlationId);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: tracingHeaders(correlationId),
      });

      clientLogger.http(`GET ${url}`, { status: res.status, durationMs: Date.now() - startedAt });

      if (unauthorizedBehavior === 'returnNull' && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      // A failed query is an error-level event, not just an http line carrying a 5xx.
      clientLogger.error(`GET ${url} failed`, {
        durationMs: Date.now() - startedAt,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      setCurrentCorrelationId(undefined);
    }
  };

/**
 * A failed mutation that nobody handles still gets told to the person.
 *
 * Most mutations pass their own `onError` and show a toast worded for what they do; those
 * are left alone, so nothing shows twice. The rest used to fail silently: the button stopped
 * spinning and the thing simply did not happen. This is the catch-all for them — a generic
 * title plus the server's sentence when it sent one.
 */
export const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    if (mutation.options.onError) return;
    toast({
      title: i18n.t('common.requestFailed', 'Something went wrong'),
      description: error instanceof ApiError ? errorMessage(error) : undefined,
      variant: 'destructive',
    });
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: 'throw' }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
