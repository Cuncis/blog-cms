import { vi, type Mock } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListManagedPostsQuery } from './dto/list-managed-posts.query.js';
import { PostsListService } from './posts-list.service.js';
import { listSelect } from './posts-list.types.js';

type CapturedSql = { sql: string; values: unknown[] };

const admin: AuthenticatedUser = { id: 'admin-1', role: Role.ADMIN };
const editor: AuthenticatedUser = { id: 'editor-1', role: Role.EDITOR };
const reader: AuthenticatedUser = { id: 'reader-1', role: Role.READER };

const row = (id: string) => ({
    id,
    slug: `slug-${id}`,
    title: `Title ${id}`,
    excerpt: null,
    status: PostStatus.PUBLISHED,
    publishedAt: new Date('2026-02-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    author: { id: 'editor-1', name: 'Ann' },
});

// Real instances, so the class defaults (page 1, limit 10) apply
const query = (overrides: Partial<ListManagedPostsQuery> = {}): ListManagedPostsQuery =>
    Object.assign(new ListManagedPostsQuery(), overrides);

describe('PostsListService', () => {
    let service: PostsListService;
    const count = vi.fn();
    const findMany = vi.fn();
    const queryRaw = vi.fn();

    const sqlAt = (call: number) => queryRaw.mock.calls[call]?.[0] as CapturedSql;
    const whereOf = (fn: Mock) =>
        (fn.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;

    beforeEach(async () => {
        [count, findMany, queryRaw].forEach((fn) => fn.mockReset());

        const prismaMock = {
            post: { count, findMany },
            $queryRaw: queryRaw,
            $transaction: (operations: unknown[]) => Promise.all(operations),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [PostsListService, { provide: PrismaService, useValue: prismaMock }],
        }).compile();

        service = moduleRef.get(PostsListService);
    });

    describe('listPublished without a search', () => {
        it('reads only published posts, newest first, with the requested page', async () => {
            count.mockResolvedValue(25);
            findMany.mockResolvedValue([row('a')]);

            await service.listPublished(query({ page: 3, limit: 5 }));

            expect(count).toHaveBeenCalledWith({ where: { status: PostStatus.PUBLISHED } });
            expect(findMany).toHaveBeenCalledWith({
                where: { status: PostStatus.PUBLISHED },
                orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
                skip: 10,
                take: 5,
                select: listSelect,
            });
            expect(queryRaw).not.toHaveBeenCalled();
        });

        it('returns the public shape only: no ids, no status, no email, no content', async () => {
            count.mockResolvedValue(1);
            findMany.mockResolvedValue([row('a')]);

            const { items } = await service.listPublished(query());

            expect(Object.keys(items[0] ?? {}).sort()).toEqual([
                'author',
                'excerpt',
                'publishedAt',
                'slug',
                'title',
            ]);
            expect(items[0]?.author).toEqual({ name: 'Ann' });
        });

        it('reports the paging metadata', async () => {
            count.mockResolvedValue(25);
            findMany.mockResolvedValue([]);

            const { meta } = await service.listPublished(query({ page: 3, limit: 5 }));

            expect(meta).toEqual({ total: 25, page: 3, limit: 5, totalPages: 5 });
        });

        it('handles an empty table', async () => {
            count.mockResolvedValue(0);
            findMany.mockResolvedValue([]);

            const result = await service.listPublished(query());

            expect(result.items).toEqual([]);
            expect(result.meta.totalPages).toBe(0);
        });
    });

    describe('listPublished with a search', () => {
        it('requires every word as a prefix and always filters on PUBLISHED', async () => {
            queryRaw.mockResolvedValueOnce([{ total: 3n }]).mockResolvedValueOnce([{ id: 'a' }]);
            findMany.mockResolvedValue([row('a')]);

            await service.listPublished(query({ q: 'Redis caching' }));

            expect(sqlAt(0).sql).toMatch(
                /SELECT COUNT\(\*\) AS total FROM posts WHERE MATCH\(title, content\) AGAINST \(\? IN BOOLEAN MODE\) AND status = \?/,
            );
            expect(sqlAt(0).values).toEqual(['+redis* +caching*', 'PUBLISHED']);

            expect(sqlAt(1).sql).toMatch(
                /ORDER BY MATCH\(title, content\) AGAINST \(\? IN BOOLEAN MODE\) DESC, publishedAt DESC, id DESC LIMIT \? OFFSET \?/,
            );
            expect(sqlAt(1).values).toEqual(['+redis* +caching*', 'PUBLISHED', '+redis* +caching*', 10, 0]);

            expect(count).not.toHaveBeenCalled();
        });

        it('never puts user text into the SQL itself, only into bound values', async () => {
            queryRaw.mockResolvedValueOnce([{ total: 0n }]).mockResolvedValueOnce([]);

            await service.listPublished(query({ q: "'; DROP TABLE posts; --" }));

            for (const call of [0, 1]) {
                expect(sqlAt(call).sql).not.toMatch(/drop/i);
            }
            expect(sqlAt(0).values[0]).toBe('+drop* +table* +posts*');
        });

        it('strips boolean operators from what the user typed', async () => {
            queryRaw.mockResolvedValueOnce([{ total: 0n }]).mockResolvedValueOnce([]);

            await service.listPublished(query({ q: '+-><()~*"@redis' }));

            expect(sqlAt(0).values[0]).toBe('+redis*');
        });

        it('computes the offset from the page and the page size', async () => {
            queryRaw.mockResolvedValueOnce([{ total: 40n }]).mockResolvedValueOnce([]);

            await service.listPublished(query({ q: 'redis', page: 3, limit: 5 }));

            expect(sqlAt(1).values.slice(-2)).toEqual([5, 10]);
        });

        it('keeps the order the database ranked the posts in', async () => {
            queryRaw
                .mockResolvedValueOnce([{ total: 3n }])
                .mockResolvedValueOnce([{ id: 'b' }, { id: 'a' }, { id: 'c' }]);
            findMany.mockResolvedValue([row('a'), row('b'), row('c')]); // Prisma returns them in another order

            const { items } = await service.listPublished(query({ q: 'redis' }));

            expect(items.map((item) => item.slug)).toEqual(['slug-b', 'slug-a', 'slug-c']);
            expect(findMany).toHaveBeenCalledWith({
                where: { id: { in: ['b', 'a', 'c'] } },
                select: listSelect,
            });
        });

        it('skips posts that were deleted between the two queries', async () => {
            queryRaw
                .mockResolvedValueOnce([{ total: 2n }])
                .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
            findMany.mockResolvedValue([row('b')]);

            const { items, meta } = await service.listPublished(query({ q: 'redis' }));

            expect(items.map((item) => item.slug)).toEqual(['slug-b']);
            expect(meta.total).toBe(2);
        });

        it('does not load any rows when nothing matches', async () => {
            queryRaw.mockResolvedValueOnce([{ total: 0n }]).mockResolvedValueOnce([]);

            const result = await service.listPublished(query({ q: 'zebrafish' }));

            expect(findMany).not.toHaveBeenCalled();
            expect(result).toEqual({ items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } });
        });

        it('turns the BigInt count into a normal number', async () => {
            queryRaw.mockResolvedValueOnce([{ total: 25n }]).mockResolvedValueOnce([]);

            const { meta } = await service.listPublished(query({ q: 'redis' }));

            expect(meta.total).toBe(25);
            expect(typeof meta.total).toBe('number');
        });

        it.each(['a to be', 'the', 'ab', '!!!', '+-'])(
            'answers 400 for %p, which has nothing searchable, without touching the database',
            async (q) => {
                await expect(service.listPublished(query({ q }))).rejects.toThrow(BadRequestException);

                expect(queryRaw).not.toHaveBeenCalled();
                expect(count).not.toHaveBeenCalled();
                expect(findMany).not.toHaveBeenCalled();
            },
        );

        it('treats a missing or null search as no search at all', async () => {
            count.mockResolvedValue(0);
            findMany.mockResolvedValue([]);

            await service.listPublished(query({ q: null }));
            await service.listPublished(query({ q: undefined }));

            expect(queryRaw).not.toHaveBeenCalled();
            expect(count).toHaveBeenCalledTimes(2);
        });
    });

    describe('listManaged', () => {
        it("shows an editor only their own posts, newest created first", async () => {
            count.mockResolvedValue(0);
            findMany.mockResolvedValue([]);

            await service.listManaged(editor, query());

            expect(whereOf(count).authorId).toBe('editor-1');
            expect(findMany).toHaveBeenCalledWith(
                expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
            );
        });

        it('shows an admin every post', async () => {
            count.mockResolvedValue(0);
            findMany.mockResolvedValue([]);

            await service.listManaged(admin, query());

            expect(whereOf(count).authorId).toBeUndefined();
            expect(whereOf(findMany).authorId).toBeUndefined();
        });

        it('passes the status filter through', async () => {
            count.mockResolvedValue(0);
            findMany.mockResolvedValue([]);

            await service.listManaged(editor, query({ status: PostStatus.DRAFT }));

            expect(whereOf(count)).toMatchObject({ status: PostStatus.DRAFT, authorId: 'editor-1' });
        });

        it('refuses readers, whatever the route guard did, and reads nothing', async () => {
            await expect(service.listManaged(reader, query())).rejects.toThrow(ForbiddenException);

            expect(count).not.toHaveBeenCalled();
            expect(findMany).not.toHaveBeenCalled();
            expect(queryRaw).not.toHaveBeenCalled();
        });

        it('returns the management shape: ids, status, and the author id', async () => {
            count.mockResolvedValue(1);
            findMany.mockResolvedValue([row('a')]);

            const { items } = await service.listManaged(editor, query());

            expect(items[0]).toEqual(row('a'));
        });

        it("limits an editor's search to their own posts, with the status filter first", async () => {
            queryRaw.mockResolvedValueOnce([{ total: 0n }]).mockResolvedValueOnce([]);

            await service.listManaged(editor, query({ q: 'redis', status: PostStatus.DRAFT }));

            expect(sqlAt(0).sql).toMatch(/AND status = \? AND authorId = \?/);
            expect(sqlAt(0).values).toEqual(['+redis*', 'DRAFT', 'editor-1']);
            expect(sqlAt(1).sql).toMatch(/ORDER BY MATCH\(title, content\) AGAINST \(\? IN BOOLEAN MODE\) DESC, createdAt DESC, id DESC/);
        });

        it("lets an admin's search cover every author", async () => {
            queryRaw.mockResolvedValueOnce([{ total: 0n }]).mockResolvedValueOnce([]);

            await service.listManaged(admin, query({ q: 'redis' }));

            expect(sqlAt(0).sql).not.toContain('authorId');
            expect(sqlAt(0).values).toEqual(['+redis*']);
        });
    });
});