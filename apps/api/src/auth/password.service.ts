import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

// OWASP's recommended minimum for Argon2id: 19 MiB memory, 2 iterations, 1 thread
const HASH_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19_456, // KiB
    timeCost: 2,
    parallelism: 1,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
    // A real hash of a random value nobody knows, used to burn the same time as a real check
    private dummyHash = '';

    async onModuleInit(): Promise<void> {
        this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
    }

    hash(password: string): Promise<string> {
        return argon2.hash(password, HASH_OPTIONS);
    }

    /** Never throws: a corrupted or foreign hash simply counts as "wrong password". */
    async verify(hash: string, password: string): Promise<boolean> {
        try {
            return await argon2.verify(hash, password);
        } catch {
            return false;
        }
    }

    /**
     * Used when the email doesn't exist: does the same amount of work as a real
     * verification so response time doesn't reveal which accounts exist. Always false.
     */
    async verifyDummy(password: string): Promise<boolean> {
        await this.verify(this.dummyHash, password);
        return false;
    }
}