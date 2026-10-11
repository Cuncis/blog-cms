import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { publicUserSelect } from '../users/users.types.js';
import {
    generateRefreshToken,
    hashRefreshToken,
    REUSE_GRACE_MS,
    RefreshTokensService,
} from './refresh-tokens.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const publicUser = {
    id: 'user-1',
    email: 'ann@example.com',
    name: 'Ann',
    role: Role.READER,
    createdAt: new Date('2026-01-01T00:00:00Z'),
};

const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'rt-1',
    tokenHash: 'irrelevant',
    familyId: 'fam-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + DAY_MS),
    revokedAt: null,
    createdAt: new Date(),
    user: publicUser,
    ...overrides,
});

describe('token helpers', () => {
    it('generates 43-character url-safe tokens that never repeat', () => {
        const tokens = new Set(Array.from({ length: 100 }, generateRefreshToken));

        expect(tokens.size).toBe(100);
        for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('hashes to 64 hex characters, deterministically', () => {
        expect(hashRefreshToken('abc')).toMatch(/^[0-9a-f]{64}$/);
        expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
        expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('abd'));
    });
});

describe('RefreshTokensService', () => {
    let service: RefreshTokensService;
    const create = vi.fn();
    const findUnique = vi.fn();
    const updateMany = vi.fn();

    beforeEach(async () => {
        [create, findUnique, updateMany].forEach((fn) => fn.mockReset());
        create.mockResolvedValue({});

        const tx = { refreshToken: { create, findUnique, updateMany } };
        const prismaMock = {
            ...tx,
            $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                RefreshTokensService,
                { provide: PrismaService, useValue: prismaMock },
                { provide: ConfigService, useValue: { get: () => 7 } },
            ],
        }).compile();

        service = moduleRef.get(RefreshTokensService);
    });

    describe('issue', () => {
        it('stores only the hash of the token, never the token itself', async () => {
            const token = await service.issue('user-1');

            expect(create).toHaveBeenCalledWith({
                data: {
                    tokenHash: hashRefreshToken(token),
                    familyId: expect.any(String) as string,
                    userId: 'user-1',
                    expiresAt: expect.any(Date) as Date,
                },
            });
            expect(JSON.stringify(create.mock.calls)).not.toContain(token);
        });

        it('expires after the configured number of days', async () => {
            await service.issue('user-1');

            const { data } = create.mock.calls[0]?.[0] as { data: { expiresAt: Date } };

            expect(Math.abs(data.expiresAt.getTime() - (Date.now() + 7 * DAY_MS))).toBeLessThan(5_000);
        });

        it('starts a new family each time, unless one is given', async () => {
            await service.issue('user-1');
            await service.issue('user-1');
            await service.issue('user-1', 'fam-existing');

            const families = create.mock.calls.map(
                (call) => (call[0] as { data: { familyId: string } }).data.familyId,
            );

            expect(families[0]).not.toBe(families[1]);
            expect(families[2]).toBe('fam-existing');
        });
    });

    describe('rotate', () => {
        it('revokes the old token and issues a new one in the same family', async () => {
            findUnique.mockResolvedValue(stored());
            updateMany.mockResolvedValue({ count: 1 });

            const result = await service.rotate('raw-old-token');

            expect(findUnique).toHaveBeenCalledWith({
                where: { tokenHash: hashRefreshToken('raw-old-token') },
                include: { user: { select: publicUserSelect } },
            });
            expect(updateMany).toHaveBeenCalledWith({
                where: { id: 'rt-1', revokedAt: null },
                data: { revokedAt: expect.any(Date) as Date },
            });
            expect(create).toHaveBeenCalledWith({
                data: expect.objectContaining({ familyId: 'fam-1', userId: 'user-1' }) as object,
            });
            expect(result.refreshToken).not.toBe('raw-old-token');
            expect(result.user).toEqual(publicUser);
        });

        it('rejects an unknown token and an expired token', async () => {
            findUnique.mockResolvedValueOnce(null);
            await expect(service.rotate('nope')).rejects.toThrow(UnauthorizedException);

            findUnique.mockResolvedValueOnce(stored({ expiresAt: new Date(Date.now() - 1_000) }));
            await expect(service.rotate('old')).rejects.toThrow(UnauthorizedException);

            expect(updateMany).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
        });

        it('treats a replayed token as theft and revokes the whole family', async () => {
            findUnique.mockResolvedValue(
                stored({ revokedAt: new Date(Date.now() - REUSE_GRACE_MS - 5_000) }),
            );
            updateMany.mockResolvedValue({ count: 3 });

            await expect(service.rotate('replayed')).rejects.toThrow(UnauthorizedException);

            expect(updateMany).toHaveBeenCalledTimes(1);
            expect(updateMany).toHaveBeenCalledWith({
                where: { familyId: 'fam-1', revokedAt: null },
                data: { revokedAt: expect.any(Date) as Date },
            });
            expect(create).not.toHaveBeenCalled();
        });

        it('rejects but does NOT revoke the family when replayed inside the grace window', async () => {
            findUnique.mockResolvedValue(stored({ revokedAt: new Date(Date.now() - 1_000) }));

            await expect(service.rotate('second-tab')).rejects.toThrow(UnauthorizedException);

            expect(updateMany).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
        });

        it('rejects when a concurrent request claimed the token first', async () => {
            findUnique.mockResolvedValue(stored());
            updateMany.mockResolvedValue({ count: 0 });

            await expect(service.rotate('raced')).rejects.toThrow(UnauthorizedException);
            expect(create).not.toHaveBeenCalled();
        });

        it('gives the same error for every kind of failure', async () => {
            const messages: unknown[] = [];

            findUnique.mockResolvedValueOnce(null);
            messages.push(await service.rotate('a').catch((e: UnauthorizedException) => e.getResponse()));

            findUnique.mockResolvedValueOnce(stored({ expiresAt: new Date(Date.now() - 1) }));
            messages.push(await service.rotate('b').catch((e: UnauthorizedException) => e.getResponse()));

            findUnique.mockResolvedValueOnce(stored({ revokedAt: new Date(Date.now() - 1_000) }));
            messages.push(await service.rotate('c').catch((e: UnauthorizedException) => e.getResponse()));

            expect(new Set(messages.map((m) => JSON.stringify(m))).size).toBe(1);
        });
    });

    describe('revocation', () => {
        it('revokeSession ends every active token in the family of the given token', async () => {
            findUnique.mockResolvedValue({ familyId: 'fam-1' });
            updateMany.mockResolvedValue({ count: 1 });

            await service.revokeSession('raw-token');

            expect(updateMany).toHaveBeenCalledWith({
                where: { familyId: 'fam-1', revokedAt: null },
                data: { revokedAt: expect.any(Date) as Date },
            });
        });

        it('revokeSession ignores an unknown token (logout is idempotent)', async () => {
            findUnique.mockResolvedValue(null);

            await expect(service.revokeSession('nope')).resolves.toBeUndefined();
            expect(updateMany).not.toHaveBeenCalled();
        });

        it('revokeAllForUser ends only the still-active tokens of that user', async () => {
            updateMany.mockResolvedValue({ count: 2 });

            await service.revokeAllForUser('user-1');

            expect(updateMany).toHaveBeenCalledWith({
                where: { userId: 'user-1', revokedAt: null },
                data: { revokedAt: expect.any(Date) as Date },
            });
        });
    });
});