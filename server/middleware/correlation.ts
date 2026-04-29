import { AsyncLocalStorage } from 'node:async_hooks';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

/**
 * Correlation ID Store
 * 
 * Uses Node.js AsyncLocalStorage to propagate a unique correlation ID
 * through the entire async call chain of a request — including database
 * queries, BullMQ jobs, and Playwright execution — without passing it
 * as an explicit parameter.
 * 
 * Usage in any file:
 *   import { getCorrelationId } from './middleware/correlation';
 *   const cid = getCorrelationId(); // returns the current ID or undefined
 */

interface CorrelationContext {
  correlationId: string;
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

/**
 * Express middleware that creates or adopts a Correlation ID for each request.
 * 
 * - If the client sends `X-Correlation-Id`, it is reused (useful for frontend-initiated traces).
 * - Otherwise, a new short UUID is generated.
 * - The ID is set on the response header so the client can see it.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-correlation-id'] as string | undefined;
  const correlationId = incoming || `req-${uuidv4().slice(0, 8)}`;

  // Set it on the response so the client can correlate
  res.setHeader('X-Correlation-Id', correlationId);

  // Run the rest of the request inside this async context
  correlationStore.run({ correlationId }, () => next());
}

/**
 * Helper to retrieve the current Correlation ID from anywhere in the call stack.
 * Returns undefined if called outside of an Express request context (e.g., during startup).
 */
export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}
