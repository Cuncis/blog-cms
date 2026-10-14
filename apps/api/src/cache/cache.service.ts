import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_STORE, type CacheStore } from './cache-store.js';
import { jitterTtl } from './jitter.js';
import { parseJson, toJson, type Serialized } from './serialize.js';

export const LOCK_TTL_MS = 5_000;
export const LOCK_WAIT_STEP_MS = 40;
export const LOCK_WAIT_ATTEMPTS = 8;

const FAILURE_LOG_INTERVAL_MS = 30_000;

const versionKey = (scope: string) => `cache:${scope}:version`;
const entryKey = (scope: string, version: number, name: string) => `cache:${scope}:v${version}:${name}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Cache-aside on top of Redis, where Redis is optional: any failure falls back to the loader.
 *
 * Every entry key contains a version number. Invalidating means bumping the version, which
 * orphans all older entries at once without scanning or deleting anything. A reader that loaded
 * old data and stores it AFTER a bump stores it under the old version, which nobody reads anymore,
 * so stale data can't be resurrected by that race.
 *
 * `scope` and `name` become part of Redis keys. Build them only from validated values, never
 * from raw user input.
 */
@Injectable()
export class CacheService {
    private readonly logger = new Logger(CacheService.name);
    private lastFailureLogAt = 0;

    constructor(@Inject(CACHE_STORE) private readonly store: CacheStore) { }

    async getOrLoad<T extends object>(
        scope: string,
        name: string,
        ttlSeconds: number,
        loader: () => Promise<T>,
    ): Promise<Serialized<T>> {
        const version = await this.attempt(() => this.readVersion(scope));
        if (version === undefined) return toJson(await loader()); // Redis is unavailable: skip the cache

        const key = entryKey(scope, version, name);

        const cached = await this.attempt(() => this.store.get(key));
        if (cached === undefined) return toJson(await loader());

        if (cached !== null) {
            const hit = parseJson<T>(cached);
            if (hit !== undefined) return hit;
        }

        return this.loadAndStore(key, ttlSeconds, loader);
    }

    /**
     * Retires every entry of a scope with one cheap INCR. Never throws: a Redis outage must not fail
     * a write that already succeeded. Returns false when the version could not be bumped, in which
     * case stale entries can live until their TTL runs out.
     */
    async invalidate(scope: string): Promise<boolean> {
        const bumped = await this.attempt(() => this.store.incr(versionKey(scope)));

        if (bumped === undefined) {
            this.logger.warn(
                `Cache invalidation for "${scope}" failed. Stale entries may be served until they expire.`,
            );
            return false;
        }

        return true;
    }

    async isHealthy(): Promise<boolean> {
        return (await this.attempt(() => this.store.ping())) === true;
    }

    private async readVersion(scope: string): Promise<number> {
        const raw = await this.store.get(versionKey(scope));
        if (raw === null) return 0; // a fresh Redis: the first INCR creates version 1

        const version = Number.parseInt(raw, 10);

        return Number.isSafeInteger(version) && version >= 0 ? version : 0;
    }

    private async loadAndStore<T extends object>(
        key: string,
        ttlSeconds: number,
        loader: () => Promise<T>,
    ): Promise<Serialized<T>> {
        const lockKey = `lock:${key}`;
        const token = randomUUID();
        const locked = await this.attempt(() => this.store.acquireLock(lockKey, token, LOCK_TTL_MS));

        if (locked === false) {
            // Another request is loading this entry: give it a moment to fill the cache
            const filled = await this.waitForFill<T>(key);
            if (filled !== undefined) return filled;
            // It didn't (it crashed, or took too long): load it ourselves
        }

        try {
            const serialized = JSON.stringify(await loader());
            await this.attempt(() => this.store.set(key, serialized, jitterTtl(ttlSeconds)));

            return JSON.parse(serialized) as Serialized<T>;
        } finally {
            // Only release a lock we actually hold, and only with our own token
            if (locked === true) await this.attempt(() => this.store.releaseLock(lockKey, token));
        }
    }

    private async waitForFill<T>(key: string): Promise<Serialized<T> | undefined> {
        for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt++) {
            await sleep(LOCK_WAIT_STEP_MS);

            const cached = await this.attempt(() => this.store.get(key));
            if (cached === undefined) return undefined; // Redis failed: stop waiting

            if (cached !== null) {
                const hit = parseJson<T>(cached);
                if (hit !== undefined) return hit;
            }
        }

        return undefined;
    }

    /** Runs one Redis operation. Returns undefined when it failed, so callers can fall back. */
    private async attempt<R>(operation: () => Promise<R>): Promise<R | undefined> {
        try {
            return await operation();
        } catch (error) {
            this.reportFailure(error);
            return undefined;
        }
    }

    /** At most one warning every 30 seconds, so an outage doesn't flood the logs. */
    private reportFailure(error: unknown): void {
        const now = Date.now();
        if (now - this.lastFailureLogAt < FAILURE_LOG_INTERVAL_MS) return;

        this.lastFailureLogAt = now;
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Cache unavailable, falling back to the database: ${reason}`);
    }
}