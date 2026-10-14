export const CACHE_STORE = Symbol('CACHE_STORE');

/** The few Redis operations the cache needs. Every method may throw while Redis is unavailable. */
export interface CacheStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    incr(key: string): Promise<number>;
    /** SET key token NX PX ttl: true only for the one caller that got the lock. */
    acquireLock(key: string, token: string, ttlMs: number): Promise<boolean>;
    /** Deletes the lock only if it still holds our token. */
    releaseLock(key: string, token: string): Promise<void>;
    ping(): Promise<boolean>;
}