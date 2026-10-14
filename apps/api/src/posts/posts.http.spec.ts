import { vi } from 'vitest';
import { NotFoundException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TokenService } from '../auth/token.service.js';
import { ManagePostsController } from './manage-posts.controller.js';
import { PostsService } from './posts.service.js';
import { PublicPostsReader } from './public-posts.reader.js';
import { PublicPostsController } from './public-posts.controller.js';

const ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const EDITOR_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const READER_ID = 'cccccccc-0000-4000-8000-000000000003';
const POST_ID = '11111111-1111-4111-8111-111111111111';

const tokens: Record<string, { sub: string; role: Role }> = {
    admin: { sub: ADMIN_ID, role: Role.ADMIN },
    editor: { sub: EDITOR_ID, role: Role.EDITOR },
    reader: { sub: READER_ID, role: Role.READER },
};

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const manageRoutes: Array<[Method, string, object | undefined]> = [
    ['post', '/manage/posts', { title: 'Hello', content: 'Body' }],
    ['get', `/manage/posts/${POST_ID}`, undefined],
    ['patch', `/manage/posts/${POST_ID}`, { title: 'New' }],
    ['delete', `/manage/posts/${POST_ID}`, undefined],
    ['post', `/manage/posts/${POST_ID}/publish`, undefined],
    ['post', `/manage/posts/${POST_ID}/unpublish`, undefined],
];

describe('posts HTTP wiring', () => {
    let app: INestApplication;

    const service = {
        getPublished: vi.fn(),
        create: vi.fn(),
        getManaged: vi.fn(),
        update: vi.fn(),
        publish: vi.fn(),
        unpublish: vi.fn(),
        remove: vi.fn(),
    };

    const verifyAccessToken = vi.fn(async (token: string) => {
        const claims = tokens[token];
        return claims ? { ...claims, iat: 1, exp: 2 } : null;
    });

    function call(method: Method, path: string, body?: object, token?: string) {
        let req = request(app.getHttpServer())[method](path);
        if (token) req = req.set('Authorization', `Bearer ${token}`);
        return body ? req.send(body) : req;
    }

    beforeEach(async () => {
        Object.values(service).forEach((fn) => fn.mockReset());
        Object.values(service).forEach((fn) => fn.mockResolvedValue({ ok: true }));

        const moduleRef = await Test.createTestingModule({
            controllers: [PublicPostsController, ManagePostsController],
            providers: [
{ provide: PostsService, useValue: service },
                { provide: PublicPostsReader, useValue: service },
                { provide: TokenService, useValue: { verifyAccessToken } },
                { provide: APP_GUARD, useClass: JwtAuthGuard },
                { provide: APP_GUARD, useClass: RolesGuard },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
        );
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    describe('public namespace', () => {
        it('serves a published post to anyone, without a token', async () => {
            service.getPublished.mockResolvedValue({ slug: 'hello', title: 'Hello' });

            const res = await call('get', '/posts/hello').expect(200);

            expect(res.body).toEqual({ slug: 'hello', title: 'Hello' });
            expect(service.getPublished).toHaveBeenCalledWith('hello');
        });

        it('answers 404 for a draft or a missing post', async () => {
            service.getPublished.mockRejectedValue(new NotFoundException('Post not found.'));

            await call('get', '/posts/a-draft').expect(404);
        });

        it.each(['post', 'put', 'patch', 'delete'] as const)(
            'has no %s route: every write lives under /manage/posts',
            async (method) => {
                await call(method, '/posts/hello', {}).expect(404);
                await call(method, '/posts', {}).expect(404);

                expect(service.create).not.toHaveBeenCalled();
                expect(service.update).not.toHaveBeenCalled();
                expect(service.remove).not.toHaveBeenCalled();
            },
        );
    });

    describe('manage namespace', () => {
        it.each(manageRoutes)('%s %s needs a login (401)', async (method, path, body) => {
            await call(method, path, body).expect(401);
            await call(method, path, body, 'not-a-real-token').expect(401);

            Object.values(service).forEach((fn) => expect(fn).not.toHaveBeenCalled());
        });

        it.each(manageRoutes)('%s %s is forbidden to readers (403)', async (method, path, body) => {
            await call(method, path, body, 'reader').expect(403);

            Object.values(service).forEach((fn) => expect(fn).not.toHaveBeenCalled());
        });

        it('creates a post for an editor, using the logged-in user and never caching the response', async () => {
            service.create.mockResolvedValue({ id: POST_ID });

            const res = await call('post', '/manage/posts', { title: 'Hello', content: 'Body' }, 'editor').expect(201);

            expect(res.headers['cache-control']).toBe('no-store');
            expect(service.create).toHaveBeenCalledWith(
                { id: EDITOR_ID, role: Role.EDITOR },
                expect.objectContaining({ title: 'Hello', content: 'Body' }),
            );
        });

        it('lets an admin through to every route', async () => {
            await call('get', `/manage/posts/${POST_ID}`, undefined, 'admin').expect(200);
            await call('patch', `/manage/posts/${POST_ID}`, { title: 'New' }, 'admin').expect(200);
            await call('post', `/manage/posts/${POST_ID}/publish`, undefined, 'admin').expect(200);
            await call('post', `/manage/posts/${POST_ID}/unpublish`, undefined, 'admin').expect(200);
            await call('delete', `/manage/posts/${POST_ID}`, undefined, 'admin').expect(204);

            expect(service.getManaged).toHaveBeenCalledWith({ id: ADMIN_ID, role: Role.ADMIN }, POST_ID);
        });

        it('marks every response that carries post data as no-store', async () => {
            const get = await call('get', `/manage/posts/${POST_ID}`, undefined, 'editor').expect(200);
            const patch = await call('patch', `/manage/posts/${POST_ID}`, { title: 'New' }, 'editor').expect(200);
            const publish = await call('post', `/manage/posts/${POST_ID}/publish`, undefined, 'editor').expect(200);

            for (const res of [get, patch, publish]) {
                expect(res.headers['cache-control']).toBe('no-store');
            }
        });

        it('rejects invalid input with 400 before reaching the service', async () => {
            const bodies: object[] = [
                { title: '   ', content: 'Body' }, // empty title
                { title: 'Hello' }, // no content
                { title: 'Hello', content: 'Body', status: 'PUBLISHED' }, // posts always start as drafts
                { title: 'Hello', content: 'Body', authorId: ADMIN_ID }, // no impersonation
                { title: 'Hello', content: 'Body', slug: 'chosen' }, // slugs come from the title
            ];

            for (const body of bodies) {
                await call('post', '/manage/posts', body, 'editor').expect(400);
            }
            expect(service.create).not.toHaveBeenCalled();
        });

        it('rejects update bodies that try to touch protected fields, or clear required ones', async () => {
            const bodies: object[] = [
                { slug: 'new-slug' },
                { status: 'DRAFT' },
                { publishedAt: '2020-01-01T00:00:00Z' },
                { title: null },
                { content: null },
            ];

            for (const body of bodies) {
                await call('patch', `/manage/posts/${POST_ID}`, body, 'editor').expect(400);
            }
            expect(service.update).not.toHaveBeenCalled();
        });

        it('rejects ids that are not UUIDs with 400', async () => {
            await call('get', '/manage/posts/not-a-uuid', undefined, 'editor').expect(400);
            await call('delete', '/manage/posts/123', undefined, 'editor').expect(400);

            expect(service.getManaged).not.toHaveBeenCalled();
            expect(service.remove).not.toHaveBeenCalled();
        });
    });
});