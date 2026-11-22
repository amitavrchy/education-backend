/** Allowed MIME types per upload category. Anything else is rejected before storage. */
export const ALLOWED_MIME_TYPES = {
  document: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/webm'],
  answerSheet: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
} as const;

export type UploadCategory = keyof typeof ALLOWED_MIME_TYPES;
