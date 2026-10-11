import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { AppConfig } from '../config/configuration.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { RefreshTokensService } from './refresh-tokens.service.js';
import { TokenService } from './token.service.js';

@Module({
    imports: [
        UsersModule,
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<AppConfig, true>) => ({
                secret: config.get('auth.accessSecret', { infer: true }),
                // Pin the algorithm for signing AND verifying: blocks "alg: none" and
                // algorithm-confusion attacks, where a token chooses how it gets checked
                signOptions: { algorithm: 'HS256' },
                verifyOptions: { algorithms: ['HS256'] },
            }),
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        PasswordService,
        TokenService,
        RefreshTokensService,
        RefreshCookieService,
    ],
    exports: [TokenService], // the global JwtAuthGuard (registered in AppModule) needs it
})
export class AuthModule { }