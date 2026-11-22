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
