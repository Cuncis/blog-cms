import { vi } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TokenService } from '../auth/token.service.js';
import { ManagePostsListController } from './manage-posts-list.controller.js';
import { PostsListService } from './posts-list.service.js';
import { PublicPostsReader } from './public-posts.reader.js';
import { PublicPostsListController } from './public-posts-list.controller.js';

const ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const EDITOR_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const READER_ID = 'cccccccc-0000-4000-8000-000000000003';

const tokens: Record<string, { sub: string; role: Role }> = {
    admin: { sub: ADMIN_ID, role: Role.ADMIN },
    editor: { sub: EDITOR_ID, role: Role.EDITOR },
    reader: { sub: READER_ID, role: Role.READER },
};

const emptyPage = { items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };

describe('post list HTTP wiring', () => {
    let app: INestApplication;

    const service = { listPublished: vi.fn(), listManaged: vi.fn() };

    const verifyAccessToken = vi.fn(async (token: string) => {
        const claims = tokens[token];
        return claims ? { ...claims, iat: 1, exp: 2 } : null;
    });

    const get = (path: string, token?: string) => {
        const req = request(app.getHttpServer()).get(path);
        return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    beforeEach(async () => {
        Object.values(service).forEach((fn) => fn.mockReset().mockResolvedValue(emptyPage));

        const moduleRef = await Test.createTestingModule({
            controllers: [PublicPostsListController, ManagePostsListController],
            providers: [
{ provide: PostsListService, useValue: service },
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

    describe('GET /posts', () => {
        it('is open to anyone and applies the defaults', async () => {
            await get('/posts').expect(200);

            expect(service.listPublished).toHaveBeenCalledWith(
                expect.objectContaining({ page: 1, limit: 10 }),
            );
        });

        it('passes the parsed paging and trimmed search text to the service', async () => {
            await get('/posts?page=2&limit=5&q=%20redis%20').expect(200);

            expect(service.listPublished).toHaveBeenCalledWith(
                expect.objectContaining({ page: 2, limit: 5, q: 'redis' }),
            );
        });

        it('treats an empty search as no search', async () => {
            await get('/posts?q=').expect(200);

            expect(service.listPublished).toHaveBeenCalledWith(expect.objectContaining({ q: null }));
        });

        it.each([
            'page=0',
            'page=-1',
            'page=abc',
            'page=1.5',
            'page=10001',
            'limit=0',
            'limit=51',
            'limit=abc',
            `q=${'a'.repeat(101)}`,
            'q=a&q=b',
            'sort=oldest', // unknown parameters are rejected
            'status=DRAFT', // the public list cannot be asked for drafts
        ])('rejects ?%s with 400 before reaching the service', async (queryString) => {
            await get(`/posts?${queryString}`).expect(400);

            expect(service.listPublished).not.toHaveBeenCalled();
        });

        it('has no write routes', async () => {
            const server = request(app.getHttpServer());

            await server.post('/posts').send({}).expect(404);
            await server.delete('/posts').expect(404);
        });
    });

    describe('GET /manage/posts', () => {
        it('needs a login (401)', async () => {
            await get('/manage/posts').expect(401);
            await get('/manage/posts', 'not-a-real-token').expect(401);

            expect(service.listManaged).not.toHaveBeenCalled();
        });

        it('is forbidden to readers (403)', async () => {
            await get('/manage/posts', 'reader').expect(403);

            expect(service.listManaged).not.toHaveBeenCalled();
        });

        it('lets editors and admins through, with the actor and the query, and never caches the response', async () => {
            const editorRes = await get('/manage/posts?status=DRAFT&page=2&q=redis', 'editor').expect(200);
            await get('/manage/posts', 'admin').expect(200);

            expect(editorRes.headers['cache-control']).toBe('no-store');
            expect(service.listManaged).toHaveBeenNthCalledWith(
                1,
                { id: EDITOR_ID, role: Role.EDITOR },
                expect.objectContaining({ status: 'DRAFT', page: 2, q: 'redis' }),
            );
            expect(service.listManaged).toHaveBeenNthCalledWith(
                2,
                { id: ADMIN_ID, role: Role.ADMIN },
                expect.objectContaining({ page: 1, limit: 10 }),
            );
        });

        it.each(['status=draft', 'status=ARCHIVED', 'status=', 'page=0', 'limit=51', 'sort=oldest'])(
            'rejects ?%s with 400',
            async (queryString) => {
                await get(`/manage/posts?${queryString}`, 'editor').expect(400);

                expect(service.listManaged).not.toHaveBeenCalled();
            },
        );
    });
});