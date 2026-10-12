import { Role, type PrismaClient } from '@prisma/client';
import { isEmail } from 'class-validator';
import type { PasswordService } from '../auth/password.service.js';

export type SeedInput = { email: string; name: string; password: string };
export type SeedOutcome = 'created' | 'promoted' | 'unchanged';

const DEFAULT_NAME = 'Administrator';

/** Reads and validates the seed settings. Reports every problem at once. */
export function parseSeedInput(env: Record<string, string | undefined>): SeedInput {
    const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    const name = (env.ADMIN_NAME ?? '').trim() || DEFAULT_NAME;
    const password = env.ADMIN_PASSWORD ?? '';

    const problems: string[] = [];

    if (email === '') {
        problems.push('ADMIN_EMAIL is required.');
    } else if (email.length > 254 || !isEmail(email)) {
        problems.push('ADMIN_EMAIL must be a valid email address (at most 254 characters).');
    }

    if (name.length > 100) problems.push('ADMIN_NAME must be at most 100 characters.');

    // The same policy as registration
    if (password === '') {
        problems.push('ADMIN_PASSWORD is required.');
    } else if (password.length < 10) {
        problems.push('ADMIN_PASSWORD must be at least 10 characters.');
    } else if (password.length > 128) {
        problems.push('ADMIN_PASSWORD must be at most 128 characters.');
    }

    if (problems.length > 0) {
        throw new Error(`Invalid seed input:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    }

    return { email, name, password };
}

/**
 * Makes sure the given account is an administrator. Safe to run any number of times:
 * - no such user: creates one (with a hashed password)
 * - user exists but is not an admin: promotes them (their password is left alone)
 * - already an admin: does nothing
 */
export async function seedAdmin(
    db: PrismaClient,
    passwords: Pick<PasswordService, 'hash'>,
    input: SeedInput,
): Promise<SeedOutcome> {
    const existing = await db.user.findUnique({
        where: { email: input.email },
        select: { id: true, role: true },
    });

    if (existing) {
        if (existing.role === Role.ADMIN) return 'unchanged';

        await db.user.update({ where: { id: existing.id }, data: { role: Role.ADMIN } });
        return 'promoted';
    }

    const passwordHash = await passwords.hash(input.password);

    await db.user.create({
        data: { email: input.email, name: input.name, passwordHash, role: Role.ADMIN },
    });
    return 'created';
}