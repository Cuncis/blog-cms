import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { publicUserSelect, type PublicUser } from '../users/users.types.js';
import { INVALID_SESSION_MESSAGE } from './auth.constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A just-rotated token replayed within this window is treated as a client race
 * (two tabs refreshing together), not as theft.
 */
export const REUSE_GRACE_MS = 10_000;

export function generateRefreshToken(): string {
    return randomBytes(32).toString('base64url'); // 256 bits, 43 characters
}

export function hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

type Rotation = {
    refreshToken: string;
    user: PublicUser;
};

const invalidSession = () => new UnauthorizedException(INVALID_SESSION_MESSAGE);

@Injectable()
export class RefreshTokensService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService<AppConfig, true>,
    ) { }

    /**
     * Creates a refresh token and stores its hash. Returns the raw token, which exists
     * only here and in the cookie. Pass an existing familyId to continue a session.
     */
    async issue(
        userId: string,
        familyId: string = randomUUID(),
        db: Prisma.TransactionClient = this.prisma,
    ): Promise<string> {
        const token = generateRefreshToken();
        const ttlDays = this.config.get('auth.refreshTtlDays', { infer: true });

        await db.refreshToken.create({
            data: {
                tokenHash: hashRefreshToken(token),
                familyId,
                userId,
                expiresAt: new Date(Date.now() + ttlDays * DAY_MS),
            },
        });

        return token;
    }

    /**
     * Exchanges a valid refresh token for a new one. The old one is revoked. The returned
     * user is read fresh from the database, so a role change shows up in the next access token.
     */
    async rotate(rawToken: string): Promise<Rotation> {
        const existing = await this.prisma.refreshToken.findUnique({
            where: { tokenHash: hashRefreshToken(rawToken) },
            include: { user: { select: publicUserSelect } },
        });

        if (!existing) throw invalidSession();

        if (existing.revokedAt) {
            // An already-rotated token is being used again. Right after rotation that is
            // probably a second tab; later on it means the token leaked, so end the session.
            if (Date.now() - existing.revokedAt.getTime() > REUSE_GRACE_MS) {
                await this.revokeFamily(existing.familyId);
            }
            throw invalidSession();
        }

        if (existing.expiresAt.getTime() <= Date.now()) throw invalidSession();

        const refreshToken = await this.prisma.$transaction(async (tx) => {
            // Atomic claim: of two concurrent requests with the same token, only one gets count 1
            const { count } = await tx.refreshToken.updateMany({
                where: { id: existing.id, revokedAt: null },
                data: { revokedAt: new Date() },
            });

            if (count !== 1) return null;

            return this.issue(existing.userId, existing.familyId, tx);
        });

        if (refreshToken === null) throw invalidSession(); // lost the race to a concurrent request

        return { refreshToken, user: existing.user };
    }

    /**
     * Ends the whole session (every token in the family) that this token belongs to.
     * Unknown tokens are ignored, so logging out is always safe to repeat.
     */
    async revokeSession(rawToken: string): Promise<void> {
        const token = await this.prisma.refreshToken.findUnique({
            where: { tokenHash: hashRefreshToken(rawToken) },
            select: { familyId: true },
        });

        if (token) {
            await this.revokeFamily(token.familyId);
        }
    }

    /** Ends every session of a user (logout everywhere). */
    async revokeAllForUser(userId: string): Promise<void> {
        await this.prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null }, // keep the original timestamps of already-revoked rows
            data: { revokedAt: new Date() },
        });
    }

    private async revokeFamily(familyId: string): Promise<void> {
        await this.prisma.refreshToken.updateMany({
            where: { familyId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }
}