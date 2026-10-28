import type { Request, Response } from 'express';

/**
 * Paging for the bare-array list routes (tests, plans, mobile tests). The response stays an
 * array so existing clients keep working; the cap bounds the cost and `X-Total-Count` tells
 * a client whether the list was cut. `?limit=` (1..max) and `?offset=` page through it.
 */
export const LIST_PAGE_DEFAULT = 1000;
export const LIST_PAGE_MAX = 1000;

export function listPage(req: Request): { limit: number; offset: number } {
  const limit = Math.min(
    Math.max(1, Number.parseInt(String(req.query.limit ?? ''), 10) || LIST_PAGE_DEFAULT),
    LIST_PAGE_MAX,
  );
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? ''), 10) || 0);
  return { limit, offset };
}

export function setTotalCount(res: Response, total: number): void {
  res.setHeader('X-Total-Count', String(total));
}
