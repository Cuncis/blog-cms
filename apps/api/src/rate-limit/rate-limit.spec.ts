import { Controller, HttpCode, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { LOGIN_LIMIT, RATE_LIMIT_MESSAGE, throttlerOptions } from './rate-limit.config.js';

// Mirrors how AuthController is decorated
@Controller('t')
class TestController {
    @Post('login')
    @HttpCode(200)
    @Throttle({ default: LOGIN_LIMIT })
    login() {
        return { ok: true };
    }

    @Post('register')
    @HttpCode(200)
    register() {
        return { ok: true };
    }
}

async function createApp(trustProxy: number | false = false): Promise<NestExpressApplication> {
    const moduleRef = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot(throttlerOptions)],
        controllers: [TestController],
        providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    const app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', trustProxy);
    await app.init();
    return app;
}

describe('rate limiting', () => {
    let app: NestExpressApplication;

    const login = (headers: Record<string, string> = {}) =>
        request(app.getHttpServer()).post('/t/login').set(headers).send({});

    afterEach(async () => {
        await app.close(); // also stops the throttler's cleanup timer so Jest can exit
    });

    it('blocks a client after the limit with a 429 in the standard shape', async () => {
        app = await createApp();

        for (let i = 0; i < LOGIN_LIMIT.limit; i++) {
            await login().expect(200);
        }

        const blocked = await login().expect(429);

        expect(blocked.body).toMatchObject({ statusCode: 429, message: RATE_LIMIT_MESSAGE });
        expect(Object.keys(blocked.headers).some((name) => name.startsWith('retry-after'))).toBe(true);
    });

    it('keeps a separate budget per route', async () => {
        app = await createApp();

        for (let i = 0; i < LOGIN_LIMIT.limit; i++) {
            await login().expect(200);
        }
        await login().expect(429);

        await request(app.getHttpServer()).post('/t/register').send({}).expect(200);
    });

    it('cannot be dodged with a spoofed X-Forwarded-For when no proxy is trusted', async () => {
        app = await createApp(false);

        for (let i = 0; i < LOGIN_LIMIT.limit; i++) {
            await login({ 'X-Forwarded-For': `10.0.0.${i}` }).expect(200);
        }

        await login({ 'X-Forwarded-For': '10.0.1.1' }).expect(429);
    });
});