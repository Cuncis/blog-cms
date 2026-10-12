import type { PrismaClient } from '@prisma/client';
import { Role } from '@prisma/client';
import { parseSeedInput, seedAdmin } from './admin-seed.js';

const validEnv = {
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'a-long-enough-password',
};

describe('parseSeedInput', () => {
    it('accepts valid input and applies the default name', () => {
        expect(parseSeedInput(validEnv)).toEqual({
            email: 'admin@example.com',
            name: 'Administrator',
            password: 'a-long-enough-password',
        });
    });

    it('trims and lowercases the email, trims the name, and leaves the password alone', () => {
        expect(
            parseSeedInput({
                ADMIN_EMAIL: '  Admin@Example.COM ',
                ADMIN_NAME: '  Site Admin ',
                ADMIN_PASSWORD: '  spaces are fine  ',
            }),
        ).toEqual({ email: 'admin@example.com', name: 'Site Admin', password: '  spaces are fine  ' });
    });

    it.each(['', '   ', 'not-an-email', 'a@', `${'a'.repeat(250)}@example.com`])(
        'rejects the email %p',
        (ADMIN_EMAIL) => {
            expect(() => parseSeedInput({ ...validEnv, ADMIN_EMAIL })).toThrow(/ADMIN_EMAIL/);
        },
    );

    it('rejects a missing email', () => {
        expect(() => parseSeedInput({ ADMIN_PASSWORD: validEnv.ADMIN_PASSWORD })).toThrow(/ADMIN_EMAIL is required/);
    });

    it('enforces the same password policy as registration: 10 to 128 characters', () => {
        expect(() => parseSeedInput({ ...validEnv, ADMIN_PASSWORD: '' })).toThrow(/ADMIN_PASSWORD is required/);
        expect(() => parseSeedInput({ ...validEnv, ADMIN_PASSWORD: 'a'.repeat(9) })).toThrow(/at least 10/);
        expect(() => parseSeedInput({ ...validEnv, ADMIN_PASSWORD: 'a'.repeat(129) })).toThrow(/at most 128/);
        expect(parseSeedInput({ ...validEnv, ADMIN_PASSWORD: 'a'.repeat(10) }).password).toHaveLength(10);
    });

    it('rejects an over-long name', () => {
        expect(() => parseSeedInput({ ...validEnv, ADMIN_NAME: 'a'.repeat(101) })).toThrow(/ADMIN_NAME/);
    });

    it('reports every problem at once', () => {
        expect(() => parseSeedInput({ ADMIN_EMAIL: 'nope', ADMIN_PASSWORD: 'short' })).toThrow(
            /ADMIN_EMAIL[\s\S]*ADMIN_PASSWORD/,
        );
    });

    it('never puts the password in an error message', () => {
        try {
            parseSeedInput({ ADMIN_EMAIL: 'nope', ADMIN_PASSWORD: 'hunter2-short' });
            throw new Error('expected parseSeedInput to throw');
        } catch (error) {
            expect(String(error)).not.toContain('hunter2-short');
        }
    });
});

describe('seedAdmin', () => {
    const findUnique = vi.fn();
    const create = vi.fn();
    const update = vi.fn();
    const hash = vi.fn();

    const db = { user: { findUnique, create, update } } as unknown as PrismaClient;
    const input = { email: 'admin@example.com', name: 'Site Admin', password: 'a-long-enough-password' };

    beforeEach(() => {
        [findUnique, create, update, hash].forEach((fn) => fn.mockReset());
        hash.mockResolvedValue('$argon2id$fake-hash');
    });

    it('creates an admin with a hashed password when the account does not exist', async () => {
        findUnique.mockResolvedValue(null);

        await expect(seedAdmin(db, { hash }, input)).resolves.toBe('created');

        expect(hash).toHaveBeenCalledWith('a-long-enough-password');
        expect(create).toHaveBeenCalledWith({
            data: {
                email: 'admin@example.com',
                name: 'Site Admin',
                passwordHash: '$argon2id$fake-hash',
                role: Role.ADMIN,
            },
        });
        expect(JSON.stringify(create.mock.calls)).not.toContain('a-long-enough-password');
    });

    it('promotes an existing non-admin and leaves their password alone', async () => {
        findUnique.mockResolvedValue({ id: 'user-1', role: Role.READER });

        await expect(seedAdmin(db, { hash }, input)).resolves.toBe('promoted');

        expect(update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { role: Role.ADMIN } });
        expect(hash).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('does nothing when the account is already an admin (idempotent)', async () => {
        findUnique.mockResolvedValue({ id: 'user-1', role: Role.ADMIN });

        await expect(seedAdmin(db, { hash }, input)).resolves.toBe('unchanged');

        expect(hash).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });
});