import { vi } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { TokenService } from '../auth/token.service.js';
import { ManagePostCoverController } from '../posts/manage-post-cover.controller.js';
import { PostCoversService } from '../posts/post-covers.service.js';
import { UploadCleanupService } from './upload-cleanup.service.js';
import { MAX_COVER_BYTES } from './uploads.constants.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

const ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const EDITOR_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const READER_ID = 'cccccccc-0000-4000-8000-000000000003';
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const POST_ID = '11111111-1111-4111-8111-111111111111';

const tokens: Record<string, { sub: string; role: Role }> = {
    admin: { sub: ADMIN_ID, role: Role.ADMIN },
    editor: { sub: EDITOR_ID, role: Role.EDITOR },
    reader: { sub: READER_ID, role: Role.READER },
};

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const routes: Array<[Method, string, object | undefined]> = [
    ['post', '/manage/uploads/cover', { contentType: 'image/png', size: 1000 }],
    ['post', `/manage/uploads/${UPLOAD_ID}/confirm`, undefined],
    ['post', '/manage/uploads/cleanup', undefined],
    ['put', `/manage/posts/${POST_ID}/cover`, { uploadId: UPLOAD_ID }],
    ['delete', `/manage/posts/${POST_ID}/cover`, undefined],
];

const badCoverBodies: object[] = [
    { contentType: 'image/gif', size: 1000 },
    { contentType: 'image/svg+xml', size: 1000 },
    { contentType: 'text/html', size: 1000 },
    { size: 1000 },
    { contentType: 'image/png' },
    { contentType: 'image/png', size: 0 },
    { contentType: 'image/png', size: -5 },
    { contentType: 'image/png', size: 1.5 },
    { contentType: 'image/png', size: '1000' },
    { contentType: 'image/png', size: MAX_COVER_BYTES + 1 },
    { contentType: 'image/png', size: 1000, key: 'covers/evil' }, // the client never picks the key
    { contentType: 'image/png', size: 1000, userId: ADMIN_ID }, // ...or the owner
];

describe('upload and cover HTTP wiring', () => {
    let app: INestApplication;

    const uploads = { createCoverUpload: vi.fn(), confirm: vi.fn() };
    const cleanup = { runOnce: vi.fn() };
    const covers = { attach: vi.fn(), detach: vi.fn() };
    const everyServiceCall = [
        uploads.createCoverUpload,
        uploads.confirm,
        cleanup.runOnce,
        covers.attach,
        covers.detach,
    ];

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
        everyServiceCall.forEach((fn) => fn.mockReset().mockResolvedValue({ ok: true }));

        const moduleRef = await Test.createTestingModule({
            controllers: [UploadsController, ManagePostCoverController],
            providers: [
                { provide: UploadsService, useValue: uploads },
                { provide: UploadCleanupService, useValue: cleanup },
                { provide: PostCoversService, useValue: covers },
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

    it.each(routes)('%s %s needs a login (401)', async (method, path, body) => {
        await call(method, path, body).expect(401);
        await call(method, path, body, 'not-a-real-token').expect(401);

        everyServiceCall.forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    it.each(routes)('%s %s is forbidden to readers (403)', async (method, path, body) => {
        await call(method, path, body, 'reader').expect(403);

        everyServiceCall.forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    it('lets only admins run the cleanup', async () => {
        await call('post', '/manage/uploads/cleanup', undefined, 'editor').expect(403);
        expect(cleanup.runOnce).not.toHaveBeenCalled();

        await call('post', '/manage/uploads/cleanup', undefined, 'admin').expect(200);
        expect(cleanup.runOnce).toHaveBeenCalledTimes(1);
    });

    describe('POST /manage/uploads/cover', () => {
        it('issues a ticket for an editor, bound to the logged-in user, and never lets it be cached', async () => {
            uploads.createCoverUpload.mockResolvedValue({ uploadId: UPLOAD_ID });

            const res = await call('post', '/manage/uploads/cover', { contentType: 'image/png', size: 1000 }, 'editor').expect(201);

            expect(res.headers['cache-control']).toBe('no-store');
            expect(uploads.createCoverUpload).toHaveBeenCalledWith(
                { id: EDITOR_ID, role: Role.EDITOR },
                expect.objectContaining({ contentType: 'image/png', size: 1000 }),
            );
        });

        it('accepts the smallest and the largest allowed size', async () => {
            await call('post', '/manage/uploads/cover', { contentType: 'image/webp', size: 1 }, 'admin').expect(201);
            await call('post', '/manage/uploads/cover', { contentType: 'image/jpeg', size: MAX_COVER_BYTES }, 'admin').expect(201);
        });

        it.each(badCoverBodies)('rejects the body %j with 400 before reaching the service', async (body) => {
            await call('post', '/manage/uploads/cover', body, 'editor').expect(400);

            expect(uploads.createCoverUpload).not.toHaveBeenCalled();
        });
    });

    describe('POST /manage/uploads/:id/confirm', () => {
        it('confirms for the logged-in user and never lets the answer be cached', async () => {
            const res = await call('post', `/manage/uploads/${UPLOAD_ID}/confirm`, undefined, 'editor').expect(200);

            expect(res.headers['cache-control']).toBe('no-store');
            expect(uploads.confirm).toHaveBeenCalledWith({ id: EDITOR_ID, role: Role.EDITOR }, UPLOAD_ID);
        });

        it('rejects an id that is not a UUID with 400', async () => {
            await call('post', '/manage/uploads/not-a-uuid/confirm', undefined, 'editor').expect(400);

            expect(uploads.confirm).not.toHaveBeenCalled();
        });
    });

    describe('PUT and DELETE /manage/posts/:id/cover', () => {
        it('attaches a cover and never lets the answer be cached', async () => {
            const res = await call('put', `/manage/posts/${POST_ID}/cover`, { uploadId: UPLOAD_ID }, 'editor').expect(200);

            expect(res.headers['cache-control']).toBe('no-store');
            expect(covers.attach).toHaveBeenCalledWith({ id: EDITOR_ID, role: Role.EDITOR }, POST_ID, UPLOAD_ID);
        });

        it('removes a cover and never lets the answer be cached', async () => {
            const res = await call('delete', `/manage/posts/${POST_ID}/cover`, undefined, 'admin').expect(200);

            expect(res.headers['cache-control']).toBe('no-store');
            expect(covers.detach).toHaveBeenCalledWith({ id: ADMIN_ID, role: Role.ADMIN }, POST_ID);
        });

        it.each<object>([
            {},
            { uploadId: 'nope' },
            { uploadId: 123 },
            { uploadId: UPLOAD_ID, postId: POST_ID },
        ])('rejects the body %j with 400', async (body) => {
            await call('put', `/manage/posts/${POST_ID}/cover`, body, 'editor').expect(400);

            expect(covers.attach).not.toHaveBeenCalled();
        });

        it('rejects a post id that is not a UUID with 400', async () => {
            await call('put', '/manage/posts/123/cover', { uploadId: UPLOAD_ID }, 'editor').expect(400);
            await call('delete', '/manage/posts/123/cover', undefined, 'editor').expect(400);

            expect(covers.attach).not.toHaveBeenCalled();
            expect(covers.detach).not.toHaveBeenCalled();
        });
    });
});