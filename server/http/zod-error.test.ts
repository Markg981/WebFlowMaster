import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { flattenZodError } from './zod-error';

describe('flattenZodError', () => {
  it('keeps the { formErrors, fieldErrors } shape', () => {
    const r = z.object({ name: z.string() }).safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      const out = flattenZodError(r.error);
      expect(out.formErrors).toEqual([]);
      expect(out.fieldErrors.name?.length).toBeGreaterThan(0);
    }
  });
});
