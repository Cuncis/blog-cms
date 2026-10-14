import { vi, type Mock } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostStatus, Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CacheService } from '../cache/cache.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PUBLIC_POSTS_SCOPE } from './posts-cache.js';
import { PostsService } from './posts.service.js';

const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });

const POST_ID = '11111111-1111-4111-8111-111111111111';
const author: AuthenticatedUser = { id: 'editor-1', role: Role.EDITOR };
const otherEditor: AuthenticatedUser = { id: 'editor-2', role: Role.EDITOR };

const storedPost = (overrides: Record<string, unknown> = {}) => ({
    id: POST_ID,
    slug: 'hello-world',
    title: 'Hello, World!',
    excerpt: null,
    content: 'Body',
    status: PostStatus.DRAFT,
    publishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    author: { id: author.id, name: 'Ann' },
    ...overrides,
});

const published = () =>
    storedPost({ status: PostStatus.PUBLISHED, publishedAt: new Date('2026-02-01T00:00:00Z') });

describe('PostsService cache invalidation', () => {
    let service: PostsService;
    const findMany = vi.fn();
    const findUnique = vi.fn();
    const create = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn();
    const del = vi.fn();
    const invalidate = vi.fn();

    beforeEach(async () => {
        [findMany, findUnique, create, update, updateMany, del, invalidate].forEach((fn) => fn.mockReset());
        findMany.mockResolvedValue([]);
        invalidate.mockResolvedValue(true);

        const prismaMock = { post: { findMany, findUnique, create, update, updateMany, delete: del } };

        const moduleRef = await Test.createTestingModule({
            providers: [
                PostsService,
                { provide: PrismaService, useValue: prismaMock },
                { provide: CacheService, useValue: { invalidate } },
            ],
        }).compile();

        service = moduleRef.get(PostsService);
    });

    it('does not invalidate when a draft is created: the public cannot see drafts', async () => {
        create.mockResolvedValue(storedPost());

        await service.create(author, { title: 'Hello', content: 'Body' });

        expect(invalidate).not.toHaveBeenCalled();
    });

    describe('update', () => {
        it('invalidates the public posts scope, and only after the write', async () => {
            findUnique.mockResolvedValue(storedPost());
            update.mockResolvedValue(storedPost({ title: 'New' }));

            await service.update(author, POST_ID, { title: 'New' });

            expect(invalidate).toHaveBeenCalledTimes(1);
            expect(invalidate).toHaveBeenCalledWith(PUBLIC_POSTS_SCOPE);
            expect(update.mock.invocationCallOrder[0]).toBeLessThan(invalidate.mock.invocationCallOrder[0] as number);
        });

        it('does not invalidate when the update is refused (not the owner)', async () => {
            findUnique.mockResolvedValue(storedPost());

            await expect(service.update(otherEditor, POST_ID, { title: 'New' })).rejects.toThrow(NotFoundException);

            expect(update).not.toHaveBeenCalled();
            expect(invalidate).not.toHaveBeenCalled();
        });

        it('does not invalidate when the post was deleted before the write', async () => {
            findUnique.mockResolvedValue(storedPost());
            update.mockRejectedValue(prismaError('P2025'));

            await expect(service.update(author, POST_ID, { title: 'New' })).rejects.toThrow(NotFoundException);

            expect(invalidate).not.toHaveBeenCalled();
        });

        it('still succeeds when the cache could not be invalidated', async () => {
            findUnique.mockResolvedValue(storedPost());
            update.mockResolvedValue(storedPost({ title: 'New' }));
            invalidate.mockResolvedValue(false);

            await expect(service.update(author, POST_ID, { title: 'New' })).resolves.toMatchObject({ title: 'New' });
        });
    });

    describe('publish and unpublish', () => {
        it('invalidates after publishing, and after the write', async () => {
            findUnique.mockResolvedValueOnce(storedPost()).mockResolvedValueOnce(published());

            await service.publish(author, POST_ID);

            expect(invalidate).toHaveBeenCalledWith(PUBLIC_POSTS_SCOPE);
            expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
                invalidate.mock.invocationCallOrder[0] as number,
            );
        });

        it('invalidates after unpublishing', async () => {
            findUnique.mockResolvedValueOnce(published()).mockResolvedValueOnce(storedPost());

            await service.unpublish(author, POST_ID);

            expect(invalidate).toHaveBeenCalledTimes(1);
        });

        it('does not invalidate when there was nothing to change', async () => {
            findUnique.mockResolvedValueOnce(published());
            await service.publish(author, POST_ID);

            findUnique.mockResolvedValueOnce(storedPost());
            await service.unpublish(author, POST_ID);

            expect(updateMany).not.toHaveBeenCalled();
            expect(invalidate).not.toHaveBeenCalled();
        });

        it('does not invalidate when the change is refused', async () => {
            findUnique.mockResolvedValue(storedPost());

            await expect(service.publish(otherEditor, POST_ID)).rejects.toThrow(NotFoundException);

            expect(invalidate).not.toHaveBeenCalled();
        });
    });

    describe('remove', () => {
        it('invalidates after deleting, and after the write', async () => {
            findUnique.mockResolvedValue(storedPost());
            del.mockResolvedValue(storedPost());

            await service.remove(author, POST_ID);

            expect(invalidate).toHaveBeenCalledWith(PUBLIC_POSTS_SCOPE);
            expect(del.mock.invocationCallOrder[0]).toBeLessThan(invalidate.mock.invocationCallOrder[0] as number);
        });

        it('does not invalidate when the delete is refused or the post is already gone', async () => {
            findUnique.mockResolvedValueOnce(storedPost());
            await expect(service.remove(otherEditor, POST_ID)).rejects.toThrow(NotFoundException);

            findUnique.mockResolvedValueOnce(storedPost());
            del.mockRejectedValue(prismaError('P2025'));
            await expect(service.remove(author, POST_ID)).rejects.toThrow(NotFoundException);

            expect(invalidate).not.toHaveBeenCalled();
        });
    });
});