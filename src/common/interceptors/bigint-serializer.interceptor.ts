import { Injectable, type CallHandler, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

function convert(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(convert);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)]));
}

/** JSON can't encode BigInt (e.g. StoredFile.sizeBytes): send it as a string. */
@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(_context: unknown, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(convert));
  }
}
