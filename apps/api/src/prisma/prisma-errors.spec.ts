import { Prisma } from '@prisma/client';
import {
    isForeignKeyViolation,
    isRecordNotFound,
    isTransactionConflict,
    isUniqueViolation,
} from './prisma-errors.js';

const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });

describe('prisma error helpers', () => {
    it.each([
        [isUniqueViolation, 'P2002'],
        [isTransactionConflict, 'P2034'],
        [isRecordNotFound, 'P2025'],
        [isForeignKeyViolation, 'P2003'],
    ])('%p matches only its own code', (helper, code) => {
        const codes = ['P2002', 'P2034', 'P2025', 'P2003'];

        for (const other of codes) {
            expect(helper(prismaError(other))).toBe(other === code);
        }
    });

    it('ignores anything that is not a known Prisma error', () => {
        for (const helper of [isUniqueViolation, isTransactionConflict, isRecordNotFound, isForeignKeyViolation]) {
            expect(helper(new Error('P2002'))).toBe(false);
            expect(helper('P2002')).toBe(false);
            expect(helper(undefined)).toBe(false);
        }
    });
});