import { vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { CacheService } from '../cache/cache.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
    const queryRaw = vi.fn();
    const isHealthy = vi.fn();

    const controller = new HealthController(
        { $queryRaw: queryRaw } as unknown as PrismaService,
        { isHealthy } as unknown as CacheService,
    );

    beforeEach(() => {
        [queryRaw, isHealthy].forEach((fn) => fn.mockReset());
        queryRaw.mockResolvedValue([{ 1: 1 }]);
        isHealthy.mockResolvedValue(true);
    });

    it('reports the database and the cache as up', async () => {
        await expect(controller.check()).resolves.toEqual({ status: 'ok', database: 'up', cache: 'up' });
    });

    it('stays healthy when only the cache is down: it is optional', async () => {
        isHealthy.mockResolvedValue(false);

        await expect(controller.check()).resolves.toEqual({ status: 'ok', database: 'up', cache: 'down' });
    });

    it('answers 503 when the database is down, and still reports the cache', async () => {
        queryRaw.mockRejectedValue(new Error('connection lost'));

        const error = await controller.check().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toEqual({
            status: 'error',
            database: 'down',
            cache: 'up',
        });
    });
});