import { Prisma } from '@prisma/client';

/** True when a write failed because it violated a UNIQUE index (Prisma error P2002). */
export function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** True when a transaction lost a write conflict or deadlock and can safely be retried (P2034). */
export function isTransactionConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}