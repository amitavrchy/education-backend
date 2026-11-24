import type { z } from 'zod';
import { invalid } from '../exceptions/app.exception.js';

/** Parses a request body with a Zod schema; failures answer 422 VALIDATION with field errors. */
export function zparse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'body';
    (errors[key] ??= []).push(issue.message);
  }
  return invalid('VALIDATION', errors);
}
