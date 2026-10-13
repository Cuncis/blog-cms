import { Prisma } from '@prisma/client';

function hasCode(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/** A write violated a UNIQUE index (P2002). */
export const isUniqueViolation = (error: unknown): boolean => hasCode(error, 'P2002');

/** A transaction lost a write conflict or deadlock and can safely be retried (P2034). */
export const isTransactionConflict = (error: unknown): boolean => hasCode(error, 'P2034');

/** An update or delete targeted a row that doesn't exist (P2025). */
export const isRecordNotFound = (error: unknown): boolean => hasCode(error, 'P2025');

/** A write referenced a row that doesn't exist, e.g. an author who was deleted (P2003). */
export const isForeignKeyViolation = (error: unknown): boolean => hasCode(error, 'P2003');