import { z } from 'zod';

/**
 * Validation details for a 400 response: `{ formErrors, fieldErrors }`, the shape the client
 * reads (see validationMessage in client/src/lib/queryClient.ts). One place, so the deprecated
 * ZodError#flatten() is not repeated in every route.
 */
export function flattenZodError<T>(error: z.ZodError<T>) {
  return z.flattenError(error);
}
