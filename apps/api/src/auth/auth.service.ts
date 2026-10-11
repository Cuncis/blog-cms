import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { isUniqueViolation } from '../prisma/prisma-errors.js';
import { UsersService } from '../users/users.service.js';
import type { PublicUser } from '../users/users.types.js';
import { AUTH_REQUIRED_MESSAGE, INVALID_SESSION_MESSAGE } from './auth.constants.js';
import type { AuthSession } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordService } from './password.service.js';
import { RefreshTokensService } from './refresh-tokens.service.js';
import { TokenService } from './token.service.js';

@Injectable()
export class AuthService {
    constructor(
        private readonly users: UsersService,
        private readonly passwords: PasswordService,
        private readonly tokens: TokenService,
        private readonly refreshTokens: RefreshTokensService,
    ) { }

    async register(dto: RegisterDto): Promise<PublicUser> {
        // Hash BEFORE touching the database, even if the email turns out to be taken.
        // Otherwise "email exists" would be visibly faster than "new account".
        const passwordHash = await this.passwords.hash(dto.password);

        try {
            return await this.users.create({ email: dto.email, name: dto.name, passwordHash });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ConflictException('An account with this email already exists.');
            }
            throw error;
        }
    }

    async login(dto: LoginDto): Promise<AuthSession> {
        const user = await this.users.findByEmail(dto.email);

        // Exactly one hash verification happens on both paths, so timing doesn't leak
        // whether the email exists.
        const passwordMatches = user
            ? await this.passwords.verify(user.passwordHash, dto.password)
            : await this.passwords.verifyDummy(dto.password);

        if (!user || !passwordMatches) {
            // Same message for "no such user" and "wrong password"
            throw new UnauthorizedException('Invalid email or password.');
        }

        const { accessToken, expiresIn } = await this.tokens.signAccessToken({
            id: user.id,
            role: user.role,
        });
        const refreshToken = await this.refreshTokens.issue(user.id); // starts a new session family

        return {
            refreshToken,
            result: {
                accessToken,
                expiresIn,
                // Built field by field so passwordHash can never slip into the response
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    createdAt: user.createdAt,
                },
            },
        };
    }

    async refresh(rawToken: string | undefined): Promise<AuthSession> {
        if (!rawToken) throw new UnauthorizedException(INVALID_SESSION_MESSAGE);

        // The user comes back fresh from the database, so a changed role lands in the new token
        const { refreshToken, user } = await this.refreshTokens.rotate(rawToken);
        const { accessToken, expiresIn } = await this.tokens.signAccessToken({
            id: user.id,
            role: user.role,
        });

        return { refreshToken, result: { accessToken, expiresIn, user } };
    }

    /** Ends the session this refresh token belongs to. Safe to call with no or unknown token. */
    async logout(rawToken: string | undefined): Promise<void> {
        if (!rawToken) return;

        await this.refreshTokens.revokeSession(rawToken);
    }

    async logoutAll(userId: string): Promise<void> {
        await this.refreshTokens.revokeAllForUser(userId);
    }

    async getProfile(userId: string): Promise<PublicUser> {
        const user = await this.users.findPublicById(userId);

        // A valid token for an account that no longer exists
        if (!user) throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);

        return user;
    }
}