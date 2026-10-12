import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import { AUTH_REQUIRED_MESSAGE, FORBIDDEN_MESSAGE } from './auth.constants.js';
import type { AuthenticatedUser } from './auth.types.js';
import { ROLES_KEY } from './decorators/roles.decorator.js';

/**
 * Runs after JwtAuthGuard. Routes without @Roles only need a valid login.
 * The role comes from the access token, so it can be up to one token lifetime out of date:
 * actions that must be exact re-check the database (see UsersService.changeRole).
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!required || required.length === 0) return true;

        const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
        const { user } = request;

        // @Roles on a @Public() route is a mistake: refuse instead of letting everyone in
        if (!user) throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);

        if (!required.includes(user.role)) throw new ForbiddenException(FORBIDDEN_MESSAGE);

        return true;
    }
}