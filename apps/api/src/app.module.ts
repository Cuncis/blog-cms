import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { CacheModule } from './cache/cache.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { configuration } from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { HealthModule } from './health/health.module.js';
import { PostsModule } from './posts/posts.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { throttlerOptions } from './rate-limit/rate-limit.config.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot(throttlerOptions),
    PrismaModule,
    CacheModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PostsModule,
    UploadsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // ORDER MATTERS. 1) the cheap rate limit rejects floods before any token work happens,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // 2) the login check sets request.user,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 3) and only then can the role check read it.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule { }