import type { DefaultJobOptions } from 'bullmq';

/** Every background queue in the system. Processors live in their owning module. */
export const QUEUE_NAMES = {
  PDF_PROCESSING: 'pdf-processing',
  OCR_PROCESSING: 'ocr-processing',
  AI_DOCUMENT_INDEXING: 'ai-document-indexing',
  QUESTION_GENERATION: 'question-generation',
  AI_ANSWER_EVALUATION: 'ai-answer-evaluation',
  EMAIL_NOTIFICATIONS: 'email-notifications',
  REPORT_GENERATION: 'report-generation',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Retries with exponential backoff, and bounded retention so Redis memory doesn't grow forever.
 * Jobs may run more than once: processors must be idempotent and producers should pass a jobId.
 */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 1_000, age: 24 * 60 * 60 },
  removeOnFail: { count: 5_000, age: 7 * 24 * 60 * 60 },
};
