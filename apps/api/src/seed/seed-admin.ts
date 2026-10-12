import { PrismaClient } from '@prisma/client';
import { PasswordService } from '../auth/password.service.js';
import { parseSeedInput, seedAdmin } from './admin-seed.js';

async function main(): Promise<void> {
    const input = parseSeedInput(process.env); // throws a readable error before touching the database

    const prisma = new PrismaClient();
    try {
        const outcome = await seedAdmin(prisma, new PasswordService(), input);

        const messages = {
            created: `Created administrator ${input.email}.`,
            promoted: `${input.email} already existed and is now an ADMIN (password unchanged).`,
            unchanged: `${input.email} is already an ADMIN. Nothing to do.`,
        } as const;

        console.log(messages[outcome]); // never print the password
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});