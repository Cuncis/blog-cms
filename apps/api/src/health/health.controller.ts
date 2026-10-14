import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { CacheService } from '../cache/cache.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Public()
@Controller('health')
export class HealthController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CacheService,
    ) { }

    @Get()
    async check() {
        // The cache is optional: without it the API is slower, not broken
        const cache = (await this.cache.isHealthy()) ? 'up' : 'down';

        try {
            await this.prisma.$queryRaw`SELECT 1`;
            return { status: 'ok', database: 'up', cache };
        } catch {
            throw new ServiceUnavailableException({ status: 'error', database: 'down', cache });
        }
    }
}