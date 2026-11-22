import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PRISMA_ERROR_CODES } from '../../database/prisma/prisma.constants.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ERROR_CODES } from '../constants/error-codes.js';
import type { ApiErrorResponse } from '../interfaces/api-response.interface.js';

const STATUS_TO_CODE: Partial<Record<number, string>> = {
  400: ERROR_CODES.BAD_REQUEST,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.PAYLOAD_TOO_LARGE,
  415: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
  429: ERROR_CODES.TOO_MANY_REQUESTS,
  501: ERROR_CODES.NOT_IMPLEMENTED,
  503: ERROR_CODES.SERVICE_UNAVAILABLE,
};

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  errors?: Record<string, string[]>;
}

/**
 * One error shape for the whole API. Unexpected errors are logged with their stack
 * and answered with a generic 500 so internals never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    const error = this.normalize(exception);
    // Deliberate HttpExceptions (501 not implemented, 503 provider disabled) are not bugs.
    if (
      !(exception instanceof HttpException) ||
      error.status === Number(HttpStatus.INTERNAL_SERVER_ERROR)
    ) {
      this.logger.error(
        { err: exception, path: request.url, requestId: request.id },
        'Unhandled exception',
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      statusCode: error.status,
      code: error.code,
      message: error.message,
      ...(error.errors && { errors: error.errors }),
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };
    response.status(error.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const fallbackCode = STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;

      if (typeof payload === 'string') return { status, code: fallbackCode, message: payload };

      const { code, message, errors } = payload as {
        code?: string;
        message?: string | string[];
        errors?: Record<string, string[]>;
      };
      return {
        status,
        code: code ?? fallbackCode,
        message: Array.isArray(message) ? message.join('; ') : (message ?? exception.message),
        errors,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT:
          return {
            status: HttpStatus.CONFLICT,
            code: ERROR_CODES.CONFLICT,
            message: 'A record with these details already exists',
          };
        case PRISMA_ERROR_CODES.RECORD_NOT_FOUND:
          return {
            status: HttpStatus.NOT_FOUND,
            code: ERROR_CODES.NOT_FOUND,
            message: 'Record not found',
          };
        case PRISMA_ERROR_CODES.FOREIGN_KEY_CONSTRAINT:
          return {
            status: HttpStatus.BAD_REQUEST,
            code: ERROR_CODES.BAD_REQUEST,
            message: 'A referenced record does not exist',
          };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    };
  }
}
