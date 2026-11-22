import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedUser,
  RequestWithUser,
} from '../interfaces/authenticated-user.interface.js';

/** `@CurrentUser() user: AuthenticatedUser` or `@CurrentUser('id') userId: string`. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    return field ? user?.[field] : user;
  },
);
