import type { PaginatedResult, PaginationMeta } from '../interfaces/api-response.interface.js';

/** Prisma `skip`/`take` for a 1-based page. */
export function toSkipTake(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPaginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
): PaginatedResult<T> {
  return { items, meta: buildPaginationMeta(page, pageSize, total) };
}
