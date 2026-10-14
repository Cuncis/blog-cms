import { vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { CacheStore } from './cache-store.js';
import { CacheService } from './cache.service.js';

class FakeStore implements CacheStore {
    readonly data = new Map<string, string>();
    readonly ttls = new Map<string, number>();
    readonly lockAttempts: Array<{ key: string; token: string }> = [];
    readonly releases: Array<{ key: string; token: string }> = [];
    broken = new Set<string>(); // names of the methods that should fail

    private guard(method: string): void {
        if (this.broken.has(method)) throw new Error(`${method} failed`);
    }

    async get(key: string): Promise<string | null> {
        this.guard('get');
        return this.data.get(key) ?? null;
    }

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
        this.guard('set');
        this.data.set(key, value);
        this.ttls.set(key, ttlSeconds);
    }

    async incr(key: string): Promise<number> {
        this.guard('incr');
        const next = Number(this.data.get(key) ?? '0') + 1;
        this.data.set(key, String(next));
        return next;
    }

    async acquireLock(key: string, token: string): Promise<boolean> {
        this.guard('acquireLock');
        this.lockAttempts.push({ key, token });
        if (this.data.has(key)) return false;
        this.data.set(key, token);
        return true;
    }

    async releaseLock(key: string, token: string): Promise<void> {
        this.guard('releaseLock');
        this.releases.push({ key, token });
        if (this.data.get(key) === token) this.data.delete(key);
    }

    async ping(): Promise<boolean> {
        this.guard('ping');
        return true;
    }
}

const ENTRY = 'cache:posts:v0:post:hello';
const LOCK = `lock:${ENTRY}`;

describe('CacheService', () => {
    let store: FakeStore;
    let service: CacheService;

    const getHello = <T extends object>(loader: () => Promise<T>, ttlSeconds = 100) =>
        service.getOrLoad('posts', 'post:hello', ttlSeconds, loader);

    beforeAll(() => {
        Logger.overrideLogger(false); // keep test output clean
    });

    beforeEach(() => {
        store = new FakeStore();
        service = new CacheService(store);
    });

    describe('getOrLoad', () => {
        it('loads on a miss, stores the JSON under the versioned key with a jittered ttl, and returns it', async () => {
            const published = new Date('2026-01-01T00:00:00Z');
            const loader = vi.fn(async () => ({ title: 'Hello', publishedAt: published }));

            const result = await getHello(loader);

            expect(loader).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ title: 'Hello', publishedAt: '2026-01-01T00:00:00.000Z' });
            expect(store.data.get(ENTRY)).toBe(JSON.stringify({ title: 'Hello', publishedAt: published }));
            expect(store.ttls.get(ENTRY)).toBeGreaterThanOrEqual(90);
            expect(store.ttls.get(ENTRY)).toBeLessThanOrEqual(110);
        });

        it('serves a hit without loading and without taking a lock', async () => {
            store.data.set(ENTRY, JSON.stringify({ title: 'From cache' }));
            const loader = vi.fn(async () => ({ title: 'From database' }));

            await expect(getHello(loader)).resolves.toEqual({ title: 'From cache' });

            expect(loader).not.toHaveBeenCalled();
            expect(store.lockAttempts).toHaveLength(0);
        });

        it('returns the same shape on a miss and on the following hit', async () => {
            const loader = async () => ({ at: new Date('2026-01-01T00:00:00Z'), tags: ['a'] });

            const miss = await getHello(loader);
            const hit = await getHello(loader);

            expect(hit).toEqual(miss);
        });

        it('retires every entry when the version changes, by orphaning them', async () => {
            const loader = vi.fn(async () => ({ n: 1 }));

            await getHello(loader);
            await getHello(loader);
            expect(loader).toHaveBeenCalledTimes(1);

            await expect(service.invalidate('posts')).resolves.toBe(true);
            expect(store.data.get('cache:posts:version')).toBe('1');

            await getHello(loader);

            expect(loader).toHaveBeenCalledTimes(2);
            expect(store.data.has('cache:posts:v1:post:hello')).toBe(true);
            expect(store.data.has(ENTRY)).toBe(true); // the old entry is never read again, and expires on its own
        });

        it('keeps scopes independent', async () => {
            const loader = vi.fn(async () => ({ n: 1 }));

            await getHello(loader);
            await service.invalidate('other-scope');
            await getHello(loader);

            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('reads the current version from Redis', async () => {
            store.data.set('cache:posts:version', '7');

            await getHello(async () => ({ n: 1 }));

            expect(store.data.has('cache:posts:v7:post:hello')).toBe(true);
        });

        it.each(['abc', '-3', ''])('treats the broken version %p as 0', async (broken) => {
            store.data.set('cache:posts:version', broken);

            await getHello(async () => ({ n: 1 }));

            expect(store.data.has(ENTRY)).toBe(true);
        });

        it.each(['get', 'set', 'acquireLock', 'releaseLock'])(
            'still answers from the database when Redis %s fails',
            async (method) => {
                store.broken = new Set([method]);
                const loader = vi.fn(async () => ({ title: 'Hello' }));

                await expect(getHello(loader)).resolves.toEqual({ title: 'Hello' });
                expect(loader).toHaveBeenCalledTimes(1);
            },
        );

        it('skips the lock entirely when Redis is down', async () => {
            store.broken = new Set(['get']);

            await getHello(async () => ({ title: 'Hello' }));

            expect(store.lockAttempts).toHaveLength(0);
        });

        it('stores nothing and releases the lock when the loader throws', async () => {
            const loader = vi.fn().mockRejectedValue(new Error('database down'));

            await expect(getHello(loader)).rejects.toThrow('database down');

            expect(store.data.has(ENTRY)).toBe(false);
            expect(store.data.has(LOCK)).toBe(false);
            expect(store.releases).toHaveLength(1);
        });

        it('takes a lock named after the entry and releases it with the same token', async () => {
            await getHello(async () => ({ n: 1 }));

            const [attempt] = store.lockAttempts;

            expect(store.lockAttempts).toHaveLength(1);
            expect(attempt?.key).toBe(LOCK);
            expect(store.releases).toEqual([{ key: LOCK, token: attempt?.token }]);
            expect(store.data.has(LOCK)).toBe(false);
        });

        it('waits for the request that holds the lock instead of querying the database', async () => {
            store.data.set(LOCK, 'someone-else');
            setTimeout(() => store.data.set(ENTRY, JSON.stringify({ from: 'the other request' })), 60);
            const loader = vi.fn(async () => ({ from: 'us' }));

            await expect(getHello(loader)).resolves.toEqual({ from: 'the other request' });

            expect(loader).not.toHaveBeenCalled();
        });

        it('loads by itself, and leaves the other lock alone, when the lock holder never delivers', async () => {
            store.data.set(LOCK, 'someone-else');
            const loader = vi.fn(async () => ({ from: 'us' }));

            await expect(getHello(loader)).resolves.toEqual({ from: 'us' });

            expect(loader).toHaveBeenCalledTimes(1);
            expect(store.data.get(ENTRY)).toBe(JSON.stringify({ from: 'us' }));
            expect(store.releases).toHaveLength(0);
            expect(store.data.get(LOCK)).toBe('someone-else');
        });

        it('lets only one of many simultaneous cold requests reach the database', async () => {
            const loader = vi.fn(async () => {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return { title: 'Hello' };
            });

            const results = await Promise.all(Array.from({ length: 10 }, () => getHello(loader)));

            expect(loader).toHaveBeenCalledTimes(1);
            for (const result of results) expect(result).toEqual({ title: 'Hello' });
        });

        it.each(['{broken', '', 'null', '"text"', '42', 'true'])(
            'treats the unusable cached value %p as a miss and replaces it',
            async (junk) => {
                store.data.set(ENTRY, junk);
                const loader = vi.fn(async () => ({ title: 'Fresh' }));

                await expect(getHello(loader)).resolves.toEqual({ title: 'Fresh' });

                expect(loader).toHaveBeenCalledTimes(1);
                expect(store.data.get(ENTRY)).toBe(JSON.stringify({ title: 'Fresh' }));
            },
        );
    });

    describe('invalidate', () => {
        it('bumps the version of the scope', async () => {
            await service.invalidate('posts');
            await service.invalidate('posts');

            expect(store.data.get('cache:posts:version')).toBe('2');
        });

        it('returns false instead of throwing when Redis is down', async () => {
            store.broken = new Set(['incr']);

            await expect(service.invalidate('posts')).resolves.toBe(false);
        });
    });

    describe('isHealthy', () => {
        it('is true when Redis answers', async () => {
            await expect(service.isHealthy()).resolves.toBe(true);
        });

        it('is false when Redis does not', async () => {
            store.broken = new Set(['ping']);

            await expect(service.isHealthy()).resolves.toBe(false);
        });
    });
});