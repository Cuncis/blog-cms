import { vi, type Mock } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PostStatus, Prisma, Role, UploadStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { CacheService } from '../cache/cache.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PostCoversService } from './post-covers.service.js';
import { PUBLIC_POSTS_SCOPE } from './posts-cache.js';
import type { PostsService } from './posts.service.js';
import { managePostSelect } from './posts.types.js';

const POST_ID = '11111111-1111-4111-8111-111111111111';
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const actor: AuthenticatedUser = { id: 'editor-1', role: Role.EDITOR };

const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });

const post = (overrides: Record<string, unknown> = {}) => ({
    id: POST_ID,
    slug: 'hello',
    title: 'Hello',
    excerpt: null,
    content: 'Body',
    status: PostStatus.DRAFT,
    publishedAt: null,
    coverImageId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    author: { id: actor.id, name: 'Ann' },
    ...overrides,
});

describe('PostCoversService', () => {
    const prisma = { upload: { findFirst: vi.fn() }, post: { update: vi.fn() } };
    const posts = { getManaged: vi.fn() };
    const cache = { invalidate: vi.fn() };

    const service = new PostCoversService(
        prisma as unknown as PrismaService,
        posts as unknown as PostsService,
        cache as unknown as CacheService,
    );

    const order = (fn: Mock) => fn.mock.invocationCallOrder[0] as number;

    beforeEach(() => {
        [prisma.upload.findFirst, prisma.post.update, posts.getManaged, cache.invalidate].forEach((fn) => fn.mockReset());

        posts.getManaged.mockResolvedValue(post());
        prisma.upload.findFirst.mockResolvedValue({ status: UploadStatus.CONFIRMED });
        prisma.post.update.mockResolvedValue(post({ coverImageId: UPLOAD_ID }));
        cache.invalidate.mockResolvedValue(true);
    });

    describe('attach', () => {
        it("checks the post, looks up the caller's own upload, writes, and invalidates after the write", async () => {
            const result = await service.attach(actor, POST_ID, UPLOAD_ID);

            expect(posts.getManaged).toHaveBeenCalledWith(actor, POST_ID);
            expect(prisma.upload.findFirst).toHaveBeenCalledWith({
                where: { id: UPLOAD_ID, userId: 'editor-1' },
                select: { status: true },
            });
            expect(prisma.post.update).toHaveBeenCalledWith({
                where: { id: POST_ID },
                data: { coverImageId: UPLOAD_ID },
                select: managePostSelect,
            });
            expect(cache.invalidate).toHaveBeenCalledWith(PUBLIC_POSTS_SCOPE);
            expect(order(prisma.post.update)).toBeLessThan(order(cache.invalidate));
            expect(result.coverImageId).toBe(UPLOAD_ID);
        });

        it("refuses a post the caller may not manage, before looking at the upload or writing anything", async () => {
            posts.getManaged.mockRejectedValue(new NotFoundException('Post not found.'));

            await expect(service.attach(actor, POST_ID, UPLOAD_ID)).rejects.toThrow(NotFoundException);

            expect(prisma.upload.findFirst).not.toHaveBeenCalled();
            expect(prisma.post.update).not.toHaveBeenCalled();
            expect(cache.invalidate).not.toHaveBeenCalled();
        });

        it("answers 404 for a missing upload, and for somebody else's (the lookup is scoped to the caller)", async () => {
            prisma.upload.findFirst.mockResolvedValue(null);

            await expect(service.attach(actor, POST_ID, UPLOAD_ID)).rejects.toThrow(/Upload not found/);
            expect(prisma.post.update).not.toHaveBeenCalled();
        });

        it('answers 409 for an upload that has not been confirmed', async () => {
            prisma.upload.findFirst.mockResolvedValue({ status: UploadStatus.PENDING });

            await expect(service.attach(actor, POST_ID, UPLOAD_ID)).rejects.toThrow(ConflictException);
            expect(prisma.post.update).not.toHaveBeenCalled();
        });

        it('answers 409 when the image is already the cover of another post, and invalidates nothing', async () => {
            prisma.post.update.mockRejectedValue(prismaError('P2002'));

            await expect(service.attach(actor, POST_ID, UPLOAD_ID)).rejects.toThrow(/already the cover of another post/);
            expect(cache.invalidate).not.toHaveBeenCalled();
        });

        it('answers 404 when the upload was cleaned up between the check and the write', async () => {
            prisma.post.update.mockRejectedValue(prismaError('P2003'));

            await expect(service.attach(actor, POST_ID, UPLOAD_ID)).rejects.toThrow(/Upload not found/);
            expect(cache.invalidate).not.toHaveBeenCalled();
        });

        it('answers 404 when the post was deleted between the check and the write', async () => {
            prisma.post.update.mockRejectedValue(prismaError('P2025'));

            await expect(service.attach(actor, POST_ID, UPLOAD_ID)).rejects.toThrow(/Post not found/);
            expect(cache.invalidate).not.toHaveBeenCalled();
        });

        it('rethrows unexpected database errors untouched', async () => {
            prisma.post.update.mockRejectedValue(new Error('connection lost'));

            await expect(service.attach(actor, POST_ID, UPLOAD_ID)).rejects.toThrow('connection lost');
        });
    });

    describe('detach', () => {
        it('clears the cover and invalidates after the write', async () => {
            posts.getManaged.mockResolvedValue(post({ coverImageId: UPLOAD_ID }));
            prisma.post.update.mockResolvedValue(post());

            const result = await service.detach(actor, POST_ID);

            expect(prisma.post.update).toHaveBeenCalledWith({
                where: { id: POST_ID },
                data: { coverImageId: null },
                select: managePostSelect,
            });
            expect(order(prisma.post.update)).toBeLessThan(order(cache.invalidate));
            expect(result.coverImageId).toBeNull();
        });

        it('does nothing, and invalidates nothing, when there is no cover', async () => {
            const result = await service.detach(actor, POST_ID);

            expect(prisma.post.update).not.toHaveBeenCalled();
            expect(cache.invalidate).not.toHaveBeenCalled();
            expect(result.coverImageId).toBeNull();
        });

        it('refuses a post the caller may not manage', async () => {
            posts.getManaged.mockRejectedValue(new NotFoundException('Post not found.'));

            await expect(service.detach(actor, POST_ID)).rejects.toThrow(NotFoundException);
            expect(prisma.post.update).not.toHaveBeenCalled();
        });

        it('answers 404 when the post was deleted meanwhile', async () => {
            posts.getManaged.mockResolvedValue(post({ coverImageId: UPLOAD_ID }));
            prisma.post.update.mockRejectedValue(prismaError('P2025'));

            await expect(service.detach(actor, POST_ID)).rejects.toThrow(/Post not found/);
            expect(cache.invalidate).not.toHaveBeenCalled();
        });
    });
});