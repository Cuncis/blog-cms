import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth.types.js';

/**
 * The user the guard authenticated. Only use on protected routes: on a @Public()
 * route the guard doesn't run, so there is no user.
 */
export const CurrentUser = createParamDecorator(
    (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
        const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
        return request.user;
    },
);