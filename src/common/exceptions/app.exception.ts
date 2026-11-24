import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '../constants/error-codes.js';

/**
 * Domain error with a stable machine-readable code.
 * `throw new AppException('EXAM_CLOSED', 'This exam is no longer accepting answers', HttpStatus.CONFLICT)`
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode | (string & {}),
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly errors?: Record<string, string[]>,
  ) {
    super({ code, message, errors }, status);
  }
}

/**
 * Domain rule violation in the frontend's format: the code is both `code` and `message`, which is
 * what the UI's errorText() looks up (OTP_INVALID, COUPON_INVALID, QUOTA_EXCEEDED, …).
 */
export function invalid(
  code: string,
  errors?: Record<string, string[]>,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
): never {
  throw new AppException(code, code, status, errors);
}

/** Ownership/visibility denials look exactly like a missing record (no probing). */
export function notFound(entity = 'Record'): never {
  throw new AppException('NOT_FOUND', `${entity} not found`, HttpStatus.NOT_FOUND);
}

export function forbidden(message = 'FORBIDDEN'): never {
  throw new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN);
}
