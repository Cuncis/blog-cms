import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Public()
@Controller('health')
export class HealthController {
    constructor(private readonly prisma: PrismaService) { }

    @Get()
    async check() {
        try {
            await this.prisma.$queryRaw`SELECT 1`;
            return { status: 'ok', database: 'up' };
        } catch {
            throw new ServiceUnavailableException({ status: 'error', database: 'down' });
        }
    }
}