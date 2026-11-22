/**
 * In-process domain events (via @nestjs/event-emitter).
 * Use them to decouple modules; move anything that must survive a crash to a queue.
 */
export const DOMAIN_EVENTS = {
  USER_REGISTERED: 'user.registered',
  USER_SIGNED_IN: 'user.signed-in',
  FILE_UPLOADED: 'file.uploaded',
  DOCUMENT_PROCESSED: 'document.processed',
  EXAM_SUBMITTED: 'exam.submitted',
  ANSWER_EVALUATED: 'answer.evaluated',
} as const;

export interface FileUploadedEvent {
  fileId: string;
  uploadedById: string | null;
  mimeType: string;
}
