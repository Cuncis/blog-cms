import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokensService } from './refresh-tokens.service.js';
import { TokenService } from './token.service.js';

const uniqueError = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
    });

const publicUser = {
    id: '6f1c8c3e-0000-4000-8000-000000000000',
    email: 'ann@example.com',
    name: 'Ann',
    role: Role.EDITOR,
    createdAt: new Date('2026-01-01T00:00:00Z'),
};

const storedUser = {
    ...publicUser,
    passwordHash: '$argon2id$stored-hash',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('AuthService', () => {
    let service: AuthService;
    const create = vi.fn();
    const findByEmail = vi.fn();
    const findPublicById = vi.fn();
    const hash = vi.fn();
    const verify = vi.fn();
    const verifyDummy = vi.fn();
    const signAccessToken = vi.fn();
    const issue = vi.fn();
    const rotate = vi.fn();
    const revokeSession = vi.fn();
    const revokeAllForUser = vi.fn();

    beforeEach(async () => {
        [
            create, findByEmail, findPublicById, hash, verify, verifyDummy,
            signAccessToken, issue, rotate, revokeSession, revokeAllForUser,
        ].forEach((fn) => fn.mockReset());

        hash.mockResolvedValue('$argon2id$fake-hash');
        verifyDummy.mockResolvedValue(false);
        signAccessToken.mockResolvedValue({ accessToken: 'jwt.token.here', expiresIn: 900 });
        issue.mockResolvedValue('raw-refresh-token');

        const moduleRef = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: UsersService, useValue: { create, findByEmail, findPublicById } },
                { provide: PasswordService, useValue: { hash, verify, verifyDummy } },
                { provide: TokenService, useValue: { signAccessToken } },
                { provide: RefreshTokensService, useValue: { issue, rotate, revokeSession, revokeAllForUser } },
            ],
        }).compile();

        service = moduleRef.get(AuthService);
    });

    describe('register', () => {
        const dto = { email: 'ann@example.com', name: 'Ann', password: 'a-long-enough-password' };

        it('stores the hash, never the plain password, and never sets a role', async () => {
            create.mockResolvedValue(publicUser);

            await service.register(dto);

            expect(hash).toHaveBeenCalledWith('a-long-enough-password');
            expect(create).toHaveBeenCalledWith({
                email: 'ann@example.com',
                name: 'Ann',
                passwordHash: '$argon2id$fake-hash',
            });
            expect(JSON.stringify(create.mock.calls)).not.toContain('a-long-enough-password');
        });

        it('throws 409 when the email is already registered, but still hashes (equal timing)', async () => {
            create.mockRejectedValue(uniqueError());

            await expect(service.register(dto)).rejects.toThrow(ConflictException);
            expect(hash).toHaveBeenCalledTimes(1);
        });

        it('rethrows unexpected database errors untouched', async () => {
            create.mockRejectedValue(new Error('connection lost'));

            await expect(service.register(dto)).rejects.toThrow('connection lost');
        });
    });

    describe('login', () => {
        const dto = { email: 'ann@example.com', password: 'correct horse battery' };

        it('signs the token with the user id and role, and returns the public user', async () => {
            findByEmail.mockResolvedValue(storedUser);
            verify.mockResolvedValue(true);

            const session = await service.login(dto);

            expect(verify).toHaveBeenCalledWith('$argon2id$stored-hash', 'correct horse battery');
            expect(signAccessToken).toHaveBeenCalledWith({ id: publicUser.id, role: Role.EDITOR });
            expect(issue).toHaveBeenCalledWith(publicUser.id);
            expect(session).toEqual({
                refreshToken: 'raw-refresh-token',
                result: { accessToken: 'jwt.token.here', expiresIn: 900, user: publicUser },
            });
        });

        it('keeps the refresh token and the password hash out of the response body', async () => {
            findByEmail.mockResolvedValue(storedUser);
            verify.mockResolvedValue(true);

            const { result } = await service.login(dto);

            expect(JSON.stringify(result)).not.toContain('raw-refresh-token');
            expect(JSON.stringify(result)).not.toContain('argon2id');
        });

        it('rejects a wrong password with 401 and issues no tokens', async () => {
            findByEmail.mockResolvedValue(storedUser);
            verify.mockResolvedValue(false);

            await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
            expect(signAccessToken).not.toHaveBeenCalled();
            expect(issue).not.toHaveBeenCalled();
        });

        it('rejects an unknown email with 401 and still does the dummy hash work', async () => {
            findByEmail.mockResolvedValue(null);

            await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
            expect(verifyDummy).toHaveBeenCalledWith('correct horse battery');
            expect(verify).not.toHaveBeenCalled();
            expect(issue).not.toHaveBeenCalled();
        });

        it('gives the exact same error for unknown email and wrong password', async () => {
            findByEmail.mockResolvedValueOnce(null);
            const unknownEmail = await service.login(dto).catch((e: UnauthorizedException) => e);

            findByEmail.mockResolvedValueOnce(storedUser);
            verify.mockResolvedValueOnce(false);
            const wrongPassword = await service.login(dto).catch((e: UnauthorizedException) => e);

            expect((unknownEmail as UnauthorizedException).getResponse()).toEqual(
                (wrongPassword as UnauthorizedException).getResponse(),
            );
        });
    });

    describe('refresh', () => {
        it.each([undefined, ''])('rejects a missing token (%p) without touching the database', async (token) => {
            await expect(service.refresh(token)).rejects.toThrow(UnauthorizedException);
            expect(rotate).not.toHaveBeenCalled();
        });

        it('signs the new access token with the role read fresh from the database', async () => {
            rotate.mockResolvedValue({ refreshToken: 'raw-new-token', user: publicUser });

            const session = await service.refresh('raw-old-token');

            expect(rotate).toHaveBeenCalledWith('raw-old-token');
            expect(signAccessToken).toHaveBeenCalledWith({ id: publicUser.id, role: Role.EDITOR });
            expect(session).toEqual({
                refreshToken: 'raw-new-token',
                result: { accessToken: 'jwt.token.here', expiresIn: 900, user: publicUser },
            });
        });

        it('issues no access token when rotation fails', async () => {
            rotate.mockRejectedValue(new UnauthorizedException('Invalid or expired session.'));

            await expect(service.refresh('bad')).rejects.toThrow(UnauthorizedException);
            expect(signAccessToken).not.toHaveBeenCalled();
        });
    });

    describe('sessions', () => {
        it('logout revokes the session of the given refresh token', async () => {
            await service.logout('raw-token');

            expect(revokeSession).toHaveBeenCalledWith('raw-token');
        });

        it.each([undefined, ''])('logout does nothing and succeeds with no token (%p)', async (token) => {
            await expect(service.logout(token)).resolves.toBeUndefined();
            expect(revokeSession).not.toHaveBeenCalled();
        });

        it('logoutAll revokes every session of the user', async () => {
            await service.logoutAll('user-1');

            expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
        });

        it('getProfile returns the public user, or 401 when the account no longer exists', async () => {
            findPublicById.mockResolvedValueOnce(publicUser);
            await expect(service.getProfile('user-1')).resolves.toEqual(publicUser);

            findPublicById.mockResolvedValueOnce(null);
            await expect(service.getProfile('deleted-user')).rejects.toThrow(UnauthorizedException);
        });
    });
});