/** Prisma error codes the API maps to HTTP responses (see AllExceptionsFilter). */
export const PRISMA_ERROR_CODES = {
  UNIQUE_CONSTRAINT: 'P2002',
  FOREIGN_KEY_CONSTRAINT: 'P2003',
  RECORD_NOT_FOUND: 'P2025',
} as const;

/** Soft-deleted rows are excluded with this filter. */
export const NOT_DELETED = { deletedAt: null } as const;
