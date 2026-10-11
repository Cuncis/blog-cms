import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from './decorators/public.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { TokenService } from './token.service.js';

// Real decorators and a real Reflector, so we test the actual @Public() wiring
class SampleController {
    @Public()
    open(): void { }

    closed(): void { }
}

function contextFor(method: 'open' | 'closed', headers: Record<string, string | undefined> = {}) {
    const request: { headers: Record<string, string | undefined>; user?: unknown } = { headers };

    const context = {
        getHandler: () => SampleController.prototype[method],
        getClass: () => SampleController,
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { context, request };
}

describe('JwtAuthGuard', () => {
    const verifyAccessToken = vi.fn();
    const guard = new JwtAuthGuard(new Reflector(), { verifyAccessToken } as unknown as TokenService);

    beforeEach(() => verifyAccessToken.mockReset());

    it('lets @Public() routes through without looking at any token', async () => {
        const { context } = contextFor('open');

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it('protects routes by default (no decorator means locked)', async () => {
        const { context } = contextFor('closed');

        await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
        expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it('rejects a non-Bearer scheme without verifying anything', async () => {
        const { context } = contextFor('closed', { authorization: 'Basic dXNlcjpwYXNz' });

        await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
        expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it('rejects a token that fails verification and attaches no user', async () => {
        verifyAccessToken.mockResolvedValue(null);
        const { context, request } = contextFor('closed', { authorization: 'Bearer forged.token.here' });

        await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
        expect(request.user).toBeUndefined();
    });

    it('accepts a valid token and attaches the user id and role to the request', async () => {
        verifyAccessToken.mockResolvedValue({ sub: 'user-1', role: 'EDITOR', iat: 1, exp: 2 });
        const { context, request } = contextFor('closed', { authorization: 'Bearer valid.token.here' });

        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(request.user).toEqual({ id: 'user-1', role: 'EDITOR' });
    });

    it('gives the exact same error for every kind of rejection', async () => {
        verifyAccessToken.mockResolvedValue(null);

        const reject = async (headers: Record<string, string | undefined>) => {
            const { context } = contextFor('closed', headers);
            return guard.canActivate(context).catch((e: UnauthorizedException) => e.getResponse());
        };

        const responses = [
            await reject({}),
            await reject({ authorization: 'Basic abc' }),
            await reject({ authorization: 'Bearer expired.or.forged' }),
        ];

        expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
    });
});