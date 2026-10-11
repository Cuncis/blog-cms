import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config/configuration.js';
import { RefreshCookieService } from './refresh-cookie.service.js';

function setup(cookieSecure: boolean) {
    const values: Record<string, unknown> = {
        'auth.cookieSecure': cookieSecure,
        'auth.refreshTtlDays': 7,
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<AppConfig, true>;

    const cookie = vi.fn();
    const clearCookie = vi.fn();

    return {
        service: new RefreshCookieService(config),
        res: { cookie, clearCookie } as unknown as Response,
        cookie,
        clearCookie,
    };
}

const requestWith = (cookies: unknown) => ({ cookies }) as unknown as Request;

describe('RefreshCookieService', () => {
    it('sets an httpOnly, SameSite=Strict cookie scoped to /auth', () => {
        const { service, res, cookie } = setup(false);

        service.set(res, 'raw-token');

        expect(cookie).toHaveBeenCalledWith('refresh_token', 'raw-token', {
            httpOnly: true,
            secure: false,
            sameSite: 'strict',
            path: '/auth',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
    });

    it('marks the cookie Secure when configured (production)', () => {
        const { service, res, cookie } = setup(true);

        service.set(res, 'raw-token');

        expect(cookie).toHaveBeenCalledWith(
            'refresh_token',
            'raw-token',
            expect.objectContaining({ secure: true }),
        );
    });

    it('clears the cookie with the same path and flags it was set with', () => {
        const { service, res, clearCookie } = setup(false);

        service.clear(res);

        expect(clearCookie).toHaveBeenCalledWith('refresh_token', {
            httpOnly: true,
            secure: false,
            sameSite: 'strict',
            path: '/auth',
        });
    });

    it('reads the cookie value, and returns undefined for anything unusable', () => {
        const { service } = setup(false);

        expect(service.read(requestWith({ refresh_token: 'abc' }))).toBe('abc');
        expect(service.read(requestWith({}))).toBeUndefined();
        expect(service.read(requestWith(undefined))).toBeUndefined();
        expect(service.read(requestWith({ refresh_token: '' }))).toBeUndefined();
        expect(service.read(requestWith({ refresh_token: { a: 1 } }))).toBeUndefined();
    });
});