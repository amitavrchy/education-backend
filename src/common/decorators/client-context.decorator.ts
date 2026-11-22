import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ClientContext {
  ipAddress?: string;
  userAgent?: string;
}

/** Caller IP and user agent, for sessions and audit logs. */
export const ClientContext = createParamDecorator(
  (_: unknown, context: ExecutionContext): ClientContext => {
    const request = context.switchToHttp().getRequest<Request>();
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  },
);
