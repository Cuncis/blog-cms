import type { ThrottlerModuleOptions } from '@nestjs/throttler';

const MINUTE_MS = 60_000; // throttler v6 measures ttl in milliseconds

export const DEFAULT_LIMIT = { limit: 100, ttl: MINUTE_MS };
export const LOGIN_LIMIT = { limit: 10, ttl: 15 * MINUTE_MS };
export const REGISTER_LIMIT = { limit: 5, ttl: 60 * MINUTE_MS };
export const REFRESH_LIMIT = { limit: 30, ttl: 15 * MINUTE_MS };

export const RATE_LIMIT_MESSAGE = 'Too many requests. Please try again later.';

export const throttlerOptions: ThrottlerModuleOptions = {
    errorMessage: RATE_LIMIT_MESSAGE,
    // Applies to every route, per client IP. Strict routes override the numbers with @Throttle
    throttlers: [{ name: 'default', ...DEFAULT_LIMIT }],
};