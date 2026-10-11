import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import type { AppConfig } from '../config/configuration.js';

export type AccessTokenPayload = {
    sub: string; // user id
    role: Role;
    iat: number;
    exp: number;
};

const VALID_ROLES: readonly string[] = Object.values(Role);

@Injectable()
export class TokenService {
    constructor(
        private readonly jwt: JwtService,
        private readonly config: ConfigService<AppConfig, true>,
    ) { }

    async signAccessToken(user: {
        id: string;
        role: Role;
    }): Promise<{ accessToken: string; expiresIn: number }> {
        const expiresIn = this.config.get('auth.accessTtlSeconds', { infer: true });

        // A JWT is signed, NOT encrypted: anyone can read it. Only put in what the server
        // needs on every request. iat and exp are added automatically.
        const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role }, { expiresIn });

        return { accessToken, expiresIn };
    }

    /**
     * Returns the payload of a valid token, or null for ANY problem: bad signature, tampering,
     * expiry, an unexpected algorithm, a missing subject, or an unknown role. The caller
     * deliberately can't tell these apart.
     */
    async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
        try {
            // Algorithms are pinned to HS256 in the JwtModule's verifyOptions
            const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);

            if (typeof payload.sub !== 'string' || payload.sub === '') return null;
            if (typeof payload.role !== 'string' || !VALID_ROLES.includes(payload.role)) return null;

            return payload;
        } catch {
            return null;
        }
    }
}