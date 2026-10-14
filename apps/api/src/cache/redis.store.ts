import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppConfig } from '../config/configuration.js';
import type { CacheStore } from './cache-store.js';

// Deletes the lock only if it is still ours: another request may own it after ours expired
const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

@Injectable()
export class RedisStore implements CacheStore, OnModuleDestroy {
    private readonly logger = new Logger(RedisStore.name);
    private readonly client: Redis;

    constructor(config: ConfigService<AppConfig, true>) {
        const { host, port, password } = config.get('redis', { infer: true });

        this.client = new Redis({
            host,
            port,
            password,
            connectTimeout: 2_000,
            // A cache must never make a request slower than the database it protects
            commandTimeout: 250,
            maxRetriesPerRequest: 1,
            // While disconnected, commands fail at once instead of piling up in memory and hanging requests
            enableOfflineQueue: false,
            // Keep reconnecting forever, backing off to every 3 seconds
            retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
        });

        this.client.on('ready', () => this.logger.log('Redis connection ready'));
        // Without a listener, an 'error' event would crash the process. Failures are handled per command.
        this.client.on('error', (error: Error) => this.logger.debug(`Redis error: ${error.message}`));
    }

    get(key: string): Promise<string | null> {
        return this.client.get(key);
    }

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
        await this.client.set(key, value, 'EX', ttlSeconds);
    }

    incr(key: string): Promise<number> {
        return this.client.incr(key);
    }

    async acquireLock(key: string, token: string, ttlMs: number): Promise<boolean> {
        const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');

        return result === 'OK';
    }

    async releaseLock(key: string, token: string): Promise<void> {
        await this.client.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
    }

    async ping(): Promise<boolean> {
        return (await this.client.ping()) === 'PONG';
    }

    async onModuleDestroy(): Promise<void> {
        try {
            await this.client.quit();
        } catch {
            this.client.disconnect(); // not connected: quit() cannot talk to the server
        }
    }
}