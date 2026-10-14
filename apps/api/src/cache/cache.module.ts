import { Global, Module } from '@nestjs/common';
import { CACHE_STORE } from './cache-store.js';
import { CacheService } from './cache.service.js';
import { RedisStore } from './redis.store.js';

@Global()
@Module({
    providers: [RedisStore, { provide: CACHE_STORE, useExisting: RedisStore }, CacheService],
    exports: [CacheService],
})
export class CacheModule { }