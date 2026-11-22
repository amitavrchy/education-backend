import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ERROR_CODES } from '../constants/error-codes.js';

/** Flatten nested class-validator errors into `{ "address.city": ["..."] }`. */
function flatten(errors: ValidationError[], parent = ''): Record<string, string[]> {
  return errors.reduce<Record<string, string[]>>((acc, error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) acc[path] = Object.values(error.constraints);
    if (error.children?.length) Object.assign(acc, flatten(error.children, path));
    return acc;
  }, {});
}

/**
 * Global DTO validation:
 * - strips unknown properties and rejects requests that send them (mass-assignment safety)
 * - transforms payloads into DTO class instances (with type coercion for query params)
 * - answers 400 with field-level errors in the standard error envelope
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    stopAtFirstError: false,
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Validation failed',
        errors: flatten(errors),
      }),
  });
}
