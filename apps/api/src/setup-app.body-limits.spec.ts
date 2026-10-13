import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MANAGE_POSTS_PATH } from './posts/posts.constants.js';
import { configureApp, JSON_BODY_LIMIT, POST_BODY_LIMIT } from './setup-app.js';

@Controller(MANAGE_POSTS_PATH)
class ContentProbe {
    @Post('echo')
    @HttpCode(200)
    echo(@Body() _body: unknown) {
        return { received: true };
    }
}

@Controller('auth')
class AuthProbe {
    @Post('echo')
    @HttpCode(200)
    echo(@Body() _body: unknown) {
        return { received: true };
    }
}

describe('configureApp body limits', () => {
    let app: NestExpressApplication;

    beforeEach(async () => {
        const values: Record<string, unknown> = {
            'app.trustProxyHops': 0,
            'app.corsOrigin': 'http://localhost:3000',
        };

        const moduleRef = await Test.createTestingModule({
            controllers: [ContentProbe, AuthProbe],
            providers: [{ provide: ConfigService, useValue: { get: (key: string) => values[key] } }],
        }).compile();

        app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
        configureApp(app);
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    const post = (path: string, size: number) =>
        request(app.getHttpServer())
            .post(path)
            .send({ blob: 'x'.repeat(size) });

    it('keeps the strict default limit everywhere except the content routes', () => {
        expect(JSON_BODY_LIMIT).toBe('10kb');
        expect(POST_BODY_LIMIT).toBe('1mb');
    });

    it('accepts small bodies everywhere', async () => {
        await post('/auth/echo', 100).expect(200);
        await post(`/${MANAGE_POSTS_PATH}/echo`, 100).expect(200);
    });

    it('accepts a long article on the content routes', async () => {
        await post(`/${MANAGE_POSTS_PATH}/echo`, 200_000).expect(200);
    });

    it('still rejects the same body on other routes with 413', async () => {
        await post('/auth/echo', 20_000).expect(413);
    });

    it('rejects bodies over the content limit with 413', async () => {
        await post(`/${MANAGE_POSTS_PATH}/echo`, 1_200_000).expect(413);
    });
});