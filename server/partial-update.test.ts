import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { partialUpdate } from '@shared/partial-update';

const createSchema = z
  .object({
    name: z.string().min(1),
    locales: z.array(z.string()).default([]),
    retry: z.enum(['none', 'once']).default('none').nullable(),
    page: z.string().transform(Number).prefault('1'),
  })
  .strict();

describe('partialUpdate', () => {
  it('leaves out every field the update does not mention, defaulted or not', () => {
    expect(partialUpdate(createSchema).parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('still validates and transforms the fields it is sent', () => {
    const update = partialUpdate(createSchema);
    expect(update.parse({ locales: ['it'], retry: null, page: '3' })).toEqual({
      locales: ['it'],
      retry: null,
      page: 3,
    });
    expect(update.safeParse({ name: '' }).success).toBe(false);
  });

  it('keeps the schema strict', () => {
    expect(partialUpdate(createSchema).safeParse({ extra: 1 }).success).toBe(false);
  });
});
