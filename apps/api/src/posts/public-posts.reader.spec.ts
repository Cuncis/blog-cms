import { vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CacheService } from '../cache/cache.service.js';
import { toJson } from '../cache/serialize.js';
import { ListPostsQuery } from './dto/list-posts.query.js';
import {
    LIST_TTL_SECONDS,
    listCacheName,
    POST_TTL_SECONDS,
    PUBLIC_POSTS_SCOPE,
} from './posts-cache.js';
import type { PostsListService } from './posts-list.service.js';
import type { PostsService } from './posts.service.js';
import { PublicPostsReader } from './public-posts.reader.js';

const query = (overrides: Partial<ListPostsQuery> = {}): ListPostsQuery =>
    Object.assign(new ListPostsQuery(), overrides);

const emptyPage = { items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } };

describe('listCacheName', () => {
    it('encodes the page, the page size, and the search terms', () => {
        expect(listCacheName(1, 10, [])).toBe('list:p1:l10:q');
        expect(listCacheName(3, 25, ['redis'])).toBe('list:p3:l25:qredis');
    });

    it('sorts the terms, because the order of the words does not change the search', () => {
        expect(listCacheName(1, 10, ['redis', 'caching'])).toBe(listCacheName(1, 10, ['caching', 'redis']));
        expect(listCacheName(1, 10, ['redis', 'caching'])).toBe('list:p1:l10:qcaching+redis');
    });

    it('gives different pages, sizes, and searches different names', () => {
        const names = new Set([
            listCacheName(1, 10, []),
            listCacheName(2, 10, []),
            listCacheName(1, 20, []),
            listCacheName(1, 10, ['redis']),
        ]);

        expect(names.size).toBe(4);
    });
});

describe('PublicPostsReader', () => {
    const getPublished = vi.fn();
    const listPublished = vi.fn();
    const getOrLoad = vi.fn();

    const reader = new PublicPostsReader(
        { getPublished } as unknown as PostsService,
        { listPublished } as unknown as PostsListService,
        { getOrLoad } as unknown as CacheService,
    );

    beforeEach(() => {
        [getPublished, listPublished, getOrLoad].forEach((fn) => fn.mockReset());

        // Behaves like a cache that always misses: run the loader, return the JSON shape
        getOrLoad.mockImplementation(
            async (_scope: string, _name: string, _ttl: number, loader: () => Promise<object>) =>
                toJson(await loader()),
        );
    });

    describe('getPublished', () => {
        it('caches a post under its lowercase slug, using the post ttl', async () => {
            getPublished.mockResolvedValue({ slug: 'hello-world', publishedAt: new Date('2026-01-01T00:00:00Z') });

            const result = await reader.getPublished('Hello-World');

            expect(getOrLoad).toHaveBeenCalledWith(
                PUBLIC_POSTS_SCOPE,
                'post:hello-world',
                POST_TTL_SECONDS,
                expect.any(Function),
            );
            expect(getPublished).toHaveBeenCalledWith('hello-world');
            expect(result).toEqual({ slug: 'hello-world', publishedAt: '2026-01-01T00:00:00.000Z' });
        });

        it.each(['', 'has space', '../etc/passwd', '-x', 'a'.repeat(201)])(
            'never touches the cache for the impossible slug %p',
            async (slug) => {
                getPublished.mockRejectedValue(new NotFoundException('Post not found.'));

                await expect(reader.getPublished(slug)).rejects.toThrow(NotFoundException);

                expect(getOrLoad).not.toHaveBeenCalled();
                expect(getPublished).toHaveBeenCalledWith(slug);
            },
        );

        it('passes the 404 of a missing or draft post through, and caches nothing for it', async () => {
            getPublished.mockRejectedValue(new NotFoundException('Post not found.'));

            await expect(reader.getPublished('a-draft')).rejects.toThrow(NotFoundException);

            expect(getOrLoad).toHaveBeenCalledTimes(1); // the real cache stores nothing when the loader throws
        });
    });

    describe('listPublished', () => {
        it('caches the default list under a name built from the paging', async () => {
            listPublished.mockResolvedValue(emptyPage);

            await reader.listPublished(query());

            expect(getOrLoad).toHaveBeenCalledWith(
                PUBLIC_POSTS_SCOPE,
                'list:p1:l10:q',
                LIST_TTL_SECONDS,
                expect.any(Function),
            );
        });

        it('names searches by their sanitized terms, ignoring case, punctuation, and word order', async () => {
            listPublished.mockResolvedValue(emptyPage);

            await reader.listPublished(query({ q: 'Redis, caching!' }));
            await reader.listPublished(query({ q: 'CACHING redis' }));
            await reader.listPublished(query({ q: '+redis -caching' }));

            const names = getOrLoad.mock.calls.map((call) => (call as unknown[])[1]);

            expect(new Set(names)).toEqual(new Set(['list:p1:l10:qcaching+redis']));
        });

        it('keeps raw user text out of the key', async () => {
            listPublished.mockResolvedValue(emptyPage);

            await reader.listPublished(query({ q: "'; DROP TABLE posts; -- \n\u0000" }));

            const name = (getOrLoad.mock.calls[0] as unknown[])[1] as string;

            expect(name).toMatch(/^list:p1:l10:q[\p{L}\p{N}_+]*$/u);
        });

        it('answers a search with nothing searchable without touching the cache', async () => {
            listPublished.mockRejectedValue(new BadRequestException('nothing to search for'));

            await expect(reader.listPublished(query({ q: 'the' }))).rejects.toThrow(BadRequestException);

            expect(getOrLoad).not.toHaveBeenCalled();
        });

        it('runs the real list service with the original query when the cache misses', async () => {
            listPublished.mockResolvedValue(emptyPage);
            const original = query({ page: 2, limit: 5, q: 'redis' });

            await reader.listPublished(original);

            expect(listPublished).toHaveBeenCalledWith(original);
        });
    });
});