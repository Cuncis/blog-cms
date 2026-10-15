import { vi, type Mock } from 'vitest';
import { Logger } from '@nestjs/common';
import { Prisma, UploadStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import { CLEANUP_BATCH, UploadCleanupService } from './upload-cleanup.service.js';
import { PENDING_MAX_AGE_MS, UNATTACHED_MAX_AGE_MS } from './uploads.constants.js';

const NOW = new Date('2026-06-10T12:00:00Z');

const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });

describe('UploadCleanupService', () => {
    const prisma = { upload: { findMany: vi.fn(), deleteMany: vi.fn() } };
    const storage = { delete: vi.fn() };

    const service = new UploadCleanupService(prisma as unknown as PrismaService, storage as unknown as ObjectStorage);

    const order = (fn: Mock) => fn.mock.invocationCallOrder[0] as number;
    const deletedKeys = () => storage.delete.mock.calls.map((call) => (call as unknown[])[0]);

    beforeAll(() => {
        Logger.overrideLogger(false); // keep test output clean
    });

    beforeEach(() => {
        [prisma.upload.findMany, prisma.upload.deleteMany, storage.delete].forEach((fn) => fn.mockReset());

        prisma.upload.findMany.mockResolvedValue([]);
        prisma.upload.deleteMany.mockResolvedValue({ count: 1 });
        storage.delete.mockResolvedValue(undefined);
    });

    it('looks for unfinished tickets past the pending window, and for old confirmed images no post uses', async () => {
        await service.runOnce(NOW);

        expect(prisma.upload.findMany).toHaveBeenNthCalledWith(1, {
            where: {
                status: UploadStatus.PENDING,
                createdAt: { lt: new Date(NOW.getTime() - PENDING_MAX_AGE_MS) },
            },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
            take: CLEANUP_BATCH,
        });
        expect(prisma.upload.findMany).toHaveBeenNthCalledWith(2, {
            where: {
                status: UploadStatus.CONFIRMED,
                confirmedAt: { lt: new Date(NOW.getTime() - UNATTACHED_MAX_AGE_MS) },
                coverOf: { is: null },
            },
            select: { id: true },
            orderBy: { confirmedAt: 'asc' },
            take: CLEANUP_BATCH,
        });
    });

    it('does nothing when nothing is stale', async () => {
        await expect(service.runOnce(NOW)).resolves.toEqual({ removed: 0, skipped: 0 });

        expect(prisma.upload.deleteMany).not.toHaveBeenCalled();
        expect(storage.delete).not.toHaveBeenCalled();
    });

    it('removes each row and then both of its objects, and counts them', async () => {
        prisma.upload.findMany.mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ id: 'b' }]);

        await expect(service.runOnce(NOW)).resolves.toEqual({ removed: 2, skipped: 0 });

        expect(prisma.upload.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: 'a', coverOf: { is: null } } });
        expect(prisma.upload.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: 'b', coverOf: { is: null } } });
        expect(deletedKeys()).toEqual(['tmp/a', 'covers/a', 'tmp/b', 'covers/b']);
    });

    it('deletes the row BEFORE the objects, so a live image can never lose its file', async () => {
        prisma.upload.findMany.mockResolvedValueOnce([{ id: 'a' }]);

        await service.runOnce(NOW);

        expect(order(prisma.upload.deleteMany)).toBeLessThan(order(storage.delete));
    });

    it('leaves the objects alone when the row could not be deleted (it was claimed or already gone)', async () => {
        prisma.upload.findMany.mockResolvedValueOnce([{ id: 'a' }]);
        prisma.upload.deleteMany.mockResolvedValue({ count: 0 });

        await expect(service.runOnce(NOW)).resolves.toEqual({ removed: 0, skipped: 1 });

        expect(storage.delete).not.toHaveBeenCalled();
    });

    it('skips an upload that became a post cover at the last moment (foreign key) and carries on', async () => {
        prisma.upload.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
        prisma.upload.deleteMany.mockRejectedValueOnce(prismaError('P2003')).mockResolvedValueOnce({ count: 1 });

        await expect(service.runOnce(NOW)).resolves.toEqual({ removed: 1, skipped: 1 });

        expect(deletedKeys()).toEqual(['tmp/b', 'covers/b']);
    });

    it('keeps going when an object cannot be deleted', async () => {
        prisma.upload.findMany.mockResolvedValueOnce([{ id: 'a' }]);
        storage.delete.mockRejectedValue(new Error('storage down'));

        await expect(service.runOnce(NOW)).resolves.toEqual({ removed: 1, skipped: 0 });
    });

    it('rethrows unexpected database errors', async () => {
        prisma.upload.findMany.mockResolvedValueOnce([{ id: 'a' }]);
        prisma.upload.deleteMany.mockRejectedValue(new Error('connection lost'));

        await expect(service.runOnce(NOW)).rejects.toThrow('connection lost');
    });
});