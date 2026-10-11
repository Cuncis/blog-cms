import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_REQUIRED_MESSAGE } from './auth.constants.js';
import type { AuthenticatedUser } from './auth.types.js';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { extractBearerToken } from './extract-bearer.js';
import { TokenService } from './token.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly tokens: TokenService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Method-level @Public() wins over class-level
        const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

        const token = extractBearerToken(request.headers.authorization);
        const payload = token ? await this.tokens.verifyAccessToken(token) : null;

        if (!payload) {
            // Identical for every failure: the client learns nothing about why
            throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
        }

        request.user = { id: payload.sub, role: payload.role };
        return true;
    }
}