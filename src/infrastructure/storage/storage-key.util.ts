import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

export type StorageFolder =
  'books' | 'pdfs' | 'images' | 'notes' | 'videos' | 'answer-sheets' | 'misc';

/**
 * Builds a collision-free, non-guessable object key, scoped by tenant:
 *   institutions/<id>/answer-sheets/2026/11/<uuid>.pdf   or   platform/books/2026/11/<uuid>.pdf
 * The user-supplied file name is never used in the key (path traversal / PII safety).
 */
export function buildStorageKey(options: {
  folder: StorageFolder;
  originalName: string;
  institutionId?: string | null;
  now?: Date;
}): string {
  const now = options.now ?? new Date();
  const scope = options.institutionId ? `institutions/${options.institutionId}` : 'platform';
  const extension = extname(options.originalName)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${scope}/${options.folder}/${now.getUTCFullYear()}/${month}/${randomUUID()}${extension}`;
}
