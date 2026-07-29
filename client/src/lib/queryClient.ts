import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { clientLogger, setCurrentCorrelationId } from "@/observability/logger";
import { getSessionId, newCorrelationId } from "@/observability/session";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
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
  return { "X-Correlation-Id": correlationId, "X-Wfm-Session-Id": getSessionId() };
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
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...tracingHeaders(correlationId),
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
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

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    const correlationId = newCorrelationId();
    setCurrentCorrelationId(correlationId);
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: tracingHeaders(correlationId),
      });

      clientLogger.http(`GET ${url}`, { status: res.status, durationMs: Date.now() - startedAt });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
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
