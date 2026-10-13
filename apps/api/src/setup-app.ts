import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/configuration.js';
import { MANAGE_POSTS_PATH } from './posts/posts.constants.js';

// Auth payloads are tiny. Anything bigger is a mistake or an attack.
export const JSON_BODY_LIMIT = '10kb';

// Posts hold long text, so the content routes (and only those) get a larger limit.
// The DTOs cap content at 200,000 characters, which fits comfortably inside 1 MB.
export const POST_BODY_LIMIT = '1mb';

// Everything app-wide lives here so tests can reuse the exact same setup.
// The app must be created with { bodyParser: false }: we register our own JSON parsers below.
export function configureApp(app: NestExpressApplication): void {
    const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

    // Only believe X-Forwarded-For for the proxies we actually run. With 0 hops the header
    // is ignored, so clients can't pick their own IP and dodge the rate limits.
    const hops = config.get('app.trustProxyHops', { infer: true });
    app.set('trust proxy', hops > 0 ? hops : false);

    app.use(helmet()); // security headers, and removes X-Powered-By

    app.enableCors({
        // A list, so other origins get no CORS headers at all. Never "*" with credentials.
        origin: [config.get('app.corsOrigin', { infer: true })],
        credentials: true, // lets the browser send the refresh cookie
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        // The throttler names its header after the limiter that fired. Browsers hide
        // custom headers from JavaScript unless they are listed here.
        exposedHeaders: ['Retry-After', 'Retry-After-default'],
        maxAge: 600, // browsers may cache the preflight answer for 10 minutes
    });

    // ORDER MATTERS: the first JSON parser to read a request body wins, and later ones skip it.
    // So the roomy parser for post routes must be registered BEFORE the strict default one.
    app.use(`/${MANAGE_POSTS_PATH}`, json({ limit: POST_BODY_LIMIT }));
    app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

    app.use(cookieParser()); // fills req.cookies from the Cookie header

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true, // strip properties that have no decorator
            forbidNonWhitelisted: true, // ...and reject the request instead of silently dropping them
            transform: true, // run our @Transform functions (email and text normalization)
        }),
    );
}