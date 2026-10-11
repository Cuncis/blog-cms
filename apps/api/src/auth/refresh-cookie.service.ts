import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../config/configuration.js';

export const REFRESH_COOKIE_NAME = 'refresh_token';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RefreshCookieService {
    constructor(private readonly config: ConfigService<AppConfig, true>) { }

    /** Must be identical when setting and clearing, or the browser keeps the old cookie. */
    private baseOptions(): CookieOptions {
        return {
            httpOnly: true, // invisible to JavaScript, so XSS can't read it
            secure: this.config.get('auth.cookieSecure', { infer: true }), // HTTPS only in production
            sameSite: 'strict', // never sent on cross-site requests (CSRF)
            path: '/auth', // only sent to /auth/* routes
        };
    }

    set(res: Response, token: string): void {
        const ttlDays = this.config.get('auth.refreshTtlDays', { infer: true });

        res.cookie(REFRESH_COOKIE_NAME, token, { ...this.baseOptions(), maxAge: ttlDays * DAY_MS });
    }

    clear(res: Response): void {
        res.clearCookie(REFRESH_COOKIE_NAME, this.baseOptions());
    }

    read(req: Request): string | undefined {
        const cookies = req.cookies as Record<string, unknown> | undefined;
        const value = cookies?.[REFRESH_COOKIE_NAME];

        return typeof value === 'string' && value !== '' ? value : undefined;
    }
}