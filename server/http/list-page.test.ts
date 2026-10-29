import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { LIST_PAGE_DEFAULT, LIST_PAGE_MAX, listPage } from './list-page';

const req = (query: Record<string, string>) => ({ query }) as unknown as Request;

describe('listPage', () => {
  it('caps a list with no parameters at the default page', () => {
    expect(listPage(req({}))).toEqual({ limit: LIST_PAGE_DEFAULT, offset: 0 });
  });

  it('honours limit and offset', () => {
    expect(listPage(req({ limit: '50', offset: '50' }))).toEqual({ limit: 50, offset: 50 });
  });

  it('clamps out-of-range and malformed values', () => {
    expect(listPage(req({ limit: '999999', offset: '-5' }))).toEqual({
      limit: LIST_PAGE_MAX,
      offset: 0,
    });
    expect(listPage(req({ limit: 'abc', offset: 'x' }))).toEqual({
      limit: LIST_PAGE_DEFAULT,
      offset: 0,
    });
  });
});
