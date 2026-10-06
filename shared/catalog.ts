import { z } from 'zod';

export interface CatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Accept strings only: Express can also parse repeated keys, arrays and nested objects.
const positiveInteger = (maximum: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(maximum));
export const catalogQuerySchema = z.object({
  page: positiveInteger(1_000_000).default('1'),
  pageSize: positiveInteger(100).default('25'),
  search: z.string().trim().max(200).default(''),
  projectId: positiveInteger(2_147_483_647).optional(),
  status: z.string().trim().min(1).max(100).optional(),
  tagIds: z.string().max(4000).transform(value => [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))]).pipe(z.array(z.string().max(100)).max(50)).default(''),
}).strict();
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
