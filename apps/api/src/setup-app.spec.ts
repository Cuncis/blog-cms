import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { configureApp } from './setup-app.js';

@Controller('t')
class ProbeController {
    @Get('ip')
    ip(@Req() req: Request) {
        return { ip: req.ip };
    }

    @Get('cookies')
    cookies(@Req() req: Request) {
        return { cookies: req.cookies as unknown };
    }

    @Post('echo')
    @HttpCode(200)
    echo(@Body() _body: unknown) {
        return { received: true };
    }
}

async function createApp(trustProxyHops = 0): Promise<NestExpressApplication> {
    const values: Record<string, unknown> = {
        'app.trustProxyHops': trustProxyHops,
        'app.corsOrigin': 'http://localhost:3000',
    };

    const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
        providers: [{ provide: ConfigService, useValue: { get: (key: string) => values[key] } }],
    }).compile();

    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    return app;
}

describe('configureApp', () => {
    let app: NestExpressApplication;
    const http = () => request(app.getHttpServer());

    afterEach(async () => {
        await app.close();
    });

    it('sets Helmet headers and hides X-Powered-By', async () => {
        app = await createApp();

        const res = await http().get('/t/ip').expect(200);

        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows the configured origin with credentials, and no other origin', async () => {
        app = await createApp();

        const allowed = await http().get('/t/ip').set('Origin', 'http://localhost:3000');
        const other = await http().get('/t/ip').set('Origin', 'http://evil.example');

        expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
        expect(allowed.headers['access-control-allow-credentials']).toBe('true');
        expect(other.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('lets the browser read the Retry-After headers', async () => {
        app = await createApp();

        const res = await http().get('/t/ip').set('Origin', 'http://localhost:3000');
        const exposed = String(res.headers['access-control-expose-headers']).toLowerCase();

        expect(exposed).toContain('retry-after');
        expect(exposed).toContain('retry-after-default');
    });

    it('accepts a small JSON body, rejects an oversized one with 413, and malformed JSON with 400', async () => {
        app = await createApp();

        await http().post('/t/echo').send({ email: 'ann@example.com' }).expect(200);
        await http().post('/t/echo').send({ blob: 'x'.repeat(20_000) }).expect(413);
        await http()
            .post('/t/echo')
            .set('Content-Type', 'application/json')
            .send('{"broken":')
            .expect(400);
    });

    it('parses the Cookie header', async () => {
        app = await createApp();

        const res = await http().get('/t/cookies').set('Cookie', 'a=1; b=2').expect(200);

        expect(res.body).toEqual({ cookies: { a: '1', b: '2' } });
    });

    it('ignores X-Forwarded-For when no proxy is trusted, and uses our proxy hop when one is', async () => {
        app = await createApp(0);
        const direct = await http().get('/t/ip').set('X-Forwarded-For', '1.1.1.1, 2.2.2.2').expect(200);
        expect((direct.body as { ip: string }).ip).not.toBe('2.2.2.2');
        await app.close();

        app = await createApp(1);
        const proxied = await http().get('/t/ip').set('X-Forwarded-For', '1.1.1.1, 2.2.2.2').expect(200);
        expect((proxied.body as { ip: string }).ip).toBe('2.2.2.2');
    });
});