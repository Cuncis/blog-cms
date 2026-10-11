import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { TokenService } from './token.service.js';

const SECRET = 'x'.repeat(48);
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const inSeconds = (offset: number) => Math.floor(Date.now() / 1000) + offset;

describe('TokenService', () => {
    let tokens: TokenService;
    let jwt: JwtService;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                JwtModule.register({
                    secret: SECRET,
                    signOptions: { algorithm: 'HS256' },
                    verifyOptions: { algorithms: ['HS256'] },
                }),
            ],
            providers: [TokenService, { provide: ConfigService, useValue: { get: () => 900 } }],
        }).compile();

        tokens = moduleRef.get(TokenService);
        jwt = moduleRef.get(JwtService);
    });

    it('signs a token with only the subject, the role, and the standard claims', async () => {
        const { accessToken, expiresIn } = await tokens.signAccessToken({ id: 'user-1', role: Role.EDITOR });
        const payload = await jwt.verifyAsync<Record<string, unknown>>(accessToken);

        expect(expiresIn).toBe(900);
        expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'sub']);
        expect(payload).toMatchObject({ sub: 'user-1', role: 'EDITOR' });
        expect(Number(payload.exp) - Number(payload.iat)).toBe(900);
    });

    it('signs with HS256', async () => {
        const { accessToken } = await tokens.signAccessToken({ id: 'user-1', role: Role.READER });
        const header = JSON.parse(Buffer.from(accessToken.split('.')[0] ?? '', 'base64url').toString()) as {
            alg: string;
        };

        expect(header.alg).toBe('HS256');
    });

    it('verifies a token it signed and returns the role', async () => {
        const { accessToken } = await tokens.signAccessToken({ id: 'user-1', role: Role.ADMIN });

        await expect(tokens.verifyAccessToken(accessToken)).resolves.toMatchObject({
            sub: 'user-1',
            role: 'ADMIN',
        });
    });

    it.each(['', 'abc', 'a.b.c', 'not a jwt at all'])('returns null for the garbage %p', async (garbage) => {
        await expect(tokens.verifyAccessToken(garbage)).resolves.toBeNull();
    });

    it('returns null for a token signed with a different secret', async () => {
        const foreign = await new JwtService({ secret: 'y'.repeat(48) }).signAsync(
            { sub: 'user-1', role: 'ADMIN' },
            { expiresIn: 900 },
        );

        await expect(tokens.verifyAccessToken(foreign)).resolves.toBeNull();
    });

    it('returns null when the role was swapped but the old signature kept (privilege escalation)', async () => {
        const { accessToken } = await tokens.signAccessToken({ id: 'user-1', role: Role.READER });
        const [header, , signature] = accessToken.split('.');
        const tampered = `${header}.${b64({ sub: 'user-1', role: 'ADMIN', exp: inSeconds(900) })}.${signature}`;

        await expect(tokens.verifyAccessToken(tampered)).resolves.toBeNull();
    });

    it('returns null for an unsigned token that claims alg "none"', async () => {
        const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
            sub: 'attacker',
            role: 'ADMIN',
            exp: inSeconds(900),
        })}.`;

        await expect(tokens.verifyAccessToken(forged)).resolves.toBeNull();
    });

    it('returns null for an expired token', async () => {
        const expired = await jwt.signAsync({ sub: 'user-1', role: 'READER', exp: inSeconds(-10) });

        await expect(tokens.verifyAccessToken(expired)).resolves.toBeNull();
    });

    it.each([
        ['no subject', { role: 'READER' }],
        ['a numeric subject', { sub: 123, role: 'READER' }],
        ['no role', { sub: 'user-1' }],
        ['an unknown role', { sub: 'user-1', role: 'SUPERUSER' }],
        ['a non-string role', { sub: 'user-1', role: 1 }],
    ])('returns null for a correctly signed token with %s', async (_label, claims) => {
        const token = await jwt.signAsync(claims, { expiresIn: 900 });

        await expect(tokens.verifyAccessToken(token)).resolves.toBeNull();
    });
});