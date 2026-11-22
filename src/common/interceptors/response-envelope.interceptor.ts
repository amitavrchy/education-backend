import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { RAW_RESPONSE_KEY } from '../constants/metadata-keys.js';
import type { ApiSuccessResponse, PaginatedResult } from '../interfaces/api-response.interface.js';

function isPaginated(value: unknown): value is PaginatedResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PaginatedResult<unknown>).items) &&
    typeof (value as PaginatedResult<unknown>).meta === 'object'
  );
}

/** Wraps every successful response as `{ success: true, data, meta? }`. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw || context.getType() !== 'http') return next.handle();

    return next.handle().pipe(
      map((data): ApiSuccessResponse<unknown> => {
        if (isPaginated(data)) return { success: true, data: data.items, meta: data.meta };
        return { success: true, data: data ?? null };
      }),
    );
  }
}
