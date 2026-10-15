import { vi, type Mock } from 'vitest';
import {
    ConflictException,
    HttpException,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
    UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Role, UploadStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ObjectChangedError, type ObjectStorage } from '../storage/object-storage.js';
import {
    COVER_CACHE_CONTROL,
    MAX_PENDING_UPLOADS,
    PENDING_MAX_AGE_MS,
    PRESIGN_TTL_SECONDS,
} from './uploads.constants.js';
import { UploadsService } from './uploads.service.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const actor: AuthenticatedUser = { id: 'editor-1', role: Role.EDITOR };
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PNG_START = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HTML_START = Uint8Array.from(Array.from('<html><scr', (char) => char.charCodeAt(0)));

const row = (overrides: Record<string, unknown> = {}) => ({
    id: UPLOAD_ID,
    userId: actor.id,
    contentType: 'image/png',
    size: 1234,
    status: UploadStatus.PENDING,
    createdAt: new Date(NOW.getTime() - 60_000),
    confirmedAt: null,
    ...overrides,
});

const stored = (overrides: Record<string, unknown> = {}) => ({
    size: 1234,
    contentType: 'image/png',
    etag: '"abc"',
    ...overrides,
});

const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });

describe('UploadsService', () => {
    const prisma = {
        upload: {
            count: vi.fn(),
            create: vi.fn(),
            findFirst: vi.fn(),
            updateMany: vi.fn(),
            deleteMany: vi.fn(),
            delete: vi.fn(),
        },
    };
    const storage = {
        presignedPost: vi.fn(),
        head: vi.fn(),
        readStart: vi.fn(),
        copy: vi.fn(),
        delete: vi.fn(),
    };

    const service = new UploadsService(prisma as unknown as PrismaService, storage as unknown as ObjectStorage);

    const firstArg = <T>(fn: Mock): T => (fn.mock.calls[0] as unknown[])[0] as T;
    const order = (fn: Mock) => fn.mock.invocationCallOrder[0] as number;

    beforeAll(() => {
        Logger.overrideLogger(false); // keep test output clean
    });

    beforeEach(() => {
        [...Object.values(prisma.upload), ...Object.values(storage)].forEach((fn) => fn.mockReset());

        prisma.upload.count.mockResolvedValue(0);
        prisma.upload.create.mockResolvedValue({});
        prisma.upload.updateMany.mockResolvedValue({ count: 1 });
        prisma.upload.deleteMany.mockResolvedValue({ count: 1 });
        prisma.upload.delete.mockResolvedValue({});
        storage.presignedPost.mockResolvedValue({ url: 'http://storage/bucket', fields: { key: 'tmp/x' } });
        storage.head.mockResolvedValue(stored());
        storage.readStart.mockResolvedValue(PNG_START);
        storage.copy.mockResolvedValue(undefined);
        storage.delete.mockResolvedValue(undefined);
    });

    describe('createCoverUpload', () => {
        const dto = { contentType: 'image/png' as const, size: 1234 };

        it('records a pending upload owned by the caller and signs a policy for the quarantine key', async () => {
            const ticket = await service.createCoverUpload(actor, dto, NOW);

            const { data } = firstArg<{ data: Record<string, unknown> }>(prisma.upload.create);
            expect(data).toEqual({
                id: expect.stringMatching(UUID) as string,
                userId: 'editor-1',
                contentType: 'image/png',
                size: 1234,
            });

            expect(storage.presignedPost).toHaveBeenCalledWith({
                key: `tmp/${String(data.id)}`,
                contentType: 'image/png',
                size: 1234,
                expiresInSeconds: PRESIGN_TTL_SECONDS,
            });
            expect(ticket).toEqual({
                uploadId: data.id,
                url: 'http://storage/bucket',
                fields: { key: 'tmp/x' },
                expiresInSeconds: PRESIGN_TTL_SECONDS,
            });
        });

        it('gives every ticket its own id', async () => {
            const a = await service.createCoverUpload(actor, dto, NOW);
            const b = await service.createCoverUpload(actor, dto, NOW);

            expect(a.uploadId).not.toBe(b.uploadId);
        });

        it("counts only the caller's recent unfinished tickets", async () => {
            await service.createCoverUpload(actor, dto, NOW);

            expect(prisma.upload.count).toHaveBeenCalledWith({
                where: {
                    userId: 'editor-1',
                    status: UploadStatus.PENDING,
                    createdAt: { gt: new Date(NOW.getTime() - PENDING_MAX_AGE_MS) },
                },
            });
        });

        it('answers 429 when there are too many unfinished tickets, and creates nothing', async () => {
            prisma.upload.count.mockResolvedValue(MAX_PENDING_UPLOADS);

            const error = await service.createCoverUpload(actor, dto, NOW).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(HttpException);
            expect((error as HttpException).getStatus()).toBe(429);
            expect(prisma.upload.create).not.toHaveBeenCalled();
            expect(storage.presignedPost).not.toHaveBeenCalled();
        });

        it('answers 401 when the account no longer exists', async () => {
            prisma.upload.create.mockRejectedValue(prismaError('P2003'));

            await expect(service.createCoverUpload(actor, dto, NOW)).rejects.toThrow(UnauthorizedException);
            expect(storage.presignedPost).not.toHaveBeenCalled();
        });

        it('removes the ticket and answers 503 when signing fails', async () => {
            storage.presignedPost.mockRejectedValue(new Error('no credentials'));

            await expect(service.createCoverUpload(actor, dto, NOW)).rejects.toThrow(ServiceUnavailableException);

            const { data } = firstArg<{ data: { id: string } }>(prisma.upload.create);
            expect(prisma.upload.delete).toHaveBeenCalledWith({ where: { id: data.id } });
        });

        it('rethrows unexpected database errors untouched', async () => {
            prisma.upload.create.mockRejectedValue(new Error('connection lost'));

            await expect(service.createCoverUpload(actor, dto, NOW)).rejects.toThrow('connection lost');
        });
    });

    describe('confirm', () => {
        beforeEach(() => {
            prisma.upload.findFirst.mockResolvedValue(row());
        });

        // A rejected file must leave no trace: no ticket, no quarantined object, and never a copy
        const expectDiscarded = () => {
            expect(prisma.upload.deleteMany).toHaveBeenCalledWith({
                where: { id: UPLOAD_ID, status: UploadStatus.PENDING },
            });
            expect(storage.delete).toHaveBeenCalledWith(`tmp/${UPLOAD_ID}`);
            expect(storage.copy).not.toHaveBeenCalled();
            expect(prisma.upload.updateMany).not.toHaveBeenCalled();
        };

        it('inspects the file, copies exactly the inspected bytes, then confirms and cleans up', async () => {
            await expect(service.confirm(actor, UPLOAD_ID, NOW)).resolves.toEqual({
                id: UPLOAD_ID,
                contentType: 'image/png',
                size: 1234,
            });

            expect(prisma.upload.findFirst).toHaveBeenCalledWith({ where: { id: UPLOAD_ID, userId: 'editor-1' } });
            expect(storage.head).toHaveBeenCalledWith(`tmp/${UPLOAD_ID}`);
            expect(storage.readStart).toHaveBeenCalledWith(`tmp/${UPLOAD_ID}`, 12);
            expect(storage.copy).toHaveBeenCalledWith({
                from: `tmp/${UPLOAD_ID}`,
                to: `covers/${UPLOAD_ID}`,
                etag: '"abc"',
                contentType: 'image/png',
                cacheControl: COVER_CACHE_CONTROL,
            });
            expect(prisma.upload.updateMany).toHaveBeenCalledWith({
                where: { id: UPLOAD_ID, status: UploadStatus.PENDING },
                data: { status: UploadStatus.CONFIRMED, confirmedAt: NOW },
            });
            expect(storage.delete).toHaveBeenCalledWith(`tmp/${UPLOAD_ID}`);
        });

        it('does the steps in a safe order: copy, then confirm, then delete the quarantined file', async () => {
            await service.confirm(actor, UPLOAD_ID, NOW);

            expect(order(storage.copy)).toBeLessThan(order(prisma.upload.updateMany));
            expect(order(prisma.upload.updateMany)).toBeLessThan(order(storage.delete));
        });

        it('accepts a content type that carries parameters, in any letter case', async () => {
            storage.head.mockResolvedValue(stored({ contentType: 'IMAGE/PNG; charset=binary' }));

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).resolves.toMatchObject({ id: UPLOAD_ID });
        });

        it("answers 404 for a missing upload, and for somebody else's (the lookup is scoped to the caller)", async () => {
            prisma.upload.findFirst.mockResolvedValue(null);

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).rejects.toThrow(NotFoundException);
            expect(storage.head).not.toHaveBeenCalled();
        });

        it('is idempotent: a confirmed upload just returns its details, without touching storage', async () => {
            prisma.upload.findFirst.mockResolvedValue(row({ status: UploadStatus.CONFIRMED, confirmedAt: NOW }));

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).resolves.toEqual({
                id: UPLOAD_ID,
                contentType: 'image/png',
                size: 1234,
            });
            expect(storage.head).not.toHaveBeenCalled();
            expect(storage.copy).not.toHaveBeenCalled();
        });

        it('answers 409 for a ticket older than the pending window, without touching storage', async () => {
            prisma.upload.findFirst.mockResolvedValue(
                row({ createdAt: new Date(NOW.getTime() - PENDING_MAX_AGE_MS - 1_000) }),
            );

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).rejects.toThrow(ConflictException);
            expect(storage.head).not.toHaveBeenCalled();
        });

        it('answers 409 when nothing was uploaded yet, and keeps the ticket so the upload can still finish', async () => {
            storage.head.mockResolvedValue(null);

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).rejects.toThrow(/No file has been uploaded/);
            expect(prisma.upload.deleteMany).not.toHaveBeenCalled();
            expect(storage.delete).not.toHaveBeenCalled();
        });

        const rejectedFiles: Array<[string, () => void]> = [
            ['a different size than announced', () => storage.head.mockResolvedValue(stored({ size: 999 }))],
            ['a different content type', () => storage.head.mockResolvedValue(stored({ contentType: 'image/jpeg' }))],
            ['no content type', () => storage.head.mockResolvedValue(stored({ contentType: undefined }))],
            ['bytes that are not an image at all', () => storage.readStart.mockResolvedValue(HTML_START)],
            [
                'PNG bytes while announcing a JPEG',
                () => {
                    prisma.upload.findFirst.mockResolvedValue(row({ contentType: 'image/jpeg' }));
                    storage.head.mockResolvedValue(stored({ contentType: 'image/jpeg' }));
                },
            ],
        ];

        it.each(rejectedFiles)('answers 422 and discards the upload for %s', async (_label, arrange) => {
            arrange();

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).rejects.toThrow(UnprocessableEntityException);

            expectDiscarded();
        });

        it('discards the upload and answers 409 when the file changes between inspection and copy', async () => {
            storage.copy.mockRejectedValue(new ObjectChangedError());

            const error = await service.confirm(actor, UPLOAD_ID, NOW).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(ConflictException);
            expect((error as Error).message).toMatch(/changed while it was being checked/);
            expect(prisma.upload.deleteMany).toHaveBeenCalledWith({
                where: { id: UPLOAD_ID, status: UploadStatus.PENDING },
            });
            expect(storage.delete).toHaveBeenCalledWith(`tmp/${UPLOAD_ID}`);
            expect(prisma.upload.updateMany).not.toHaveBeenCalled();
        });

        const storageFailures: Array<[string, () => void]> = [
            ['looking at the object', () => storage.head.mockRejectedValue(new Error('secret-detail at 10.0.0.5:9000'))],
            ['reading its first bytes', () => storage.readStart.mockRejectedValue(new Error('secret-detail'))],
            ['copying it', () => storage.copy.mockRejectedValue(new Error('secret-detail'))],
        ];

        it.each(storageFailures)(
            'answers 503, keeps the ticket, and leaks nothing when storage fails while %s',
            async (_label, arrange) => {
                arrange();

                const error = await service.confirm(actor, UPLOAD_ID, NOW).catch((e: unknown) => e);

                expect(error).toBeInstanceOf(ServiceUnavailableException);
                expect((error as Error).message).not.toContain('secret-detail');
                expect(prisma.upload.deleteMany).not.toHaveBeenCalled();
                expect(prisma.upload.updateMany).not.toHaveBeenCalled();
            },
        );

        it('returns the details when a concurrent confirm finished first', async () => {
            prisma.upload.findFirst
                .mockResolvedValueOnce(row())
                .mockResolvedValueOnce(row({ status: UploadStatus.CONFIRMED, confirmedAt: NOW }));
            prisma.upload.updateMany.mockResolvedValue({ count: 0 });

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).resolves.toEqual({
                id: UPLOAD_ID,
                contentType: 'image/png',
                size: 1234,
            });
            expect(storage.delete).not.toHaveBeenCalled();
        });

        it('answers 409 when the ticket vanished while confirming', async () => {
            prisma.upload.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
            prisma.upload.updateMany.mockResolvedValue({ count: 0 });

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).rejects.toThrow(ConflictException);
        });

        it('still succeeds when the quarantined file cannot be deleted afterwards (cleanup will get it)', async () => {
            storage.delete.mockRejectedValue(new Error('down'));

            await expect(service.confirm(actor, UPLOAD_ID, NOW)).resolves.toMatchObject({ id: UPLOAD_ID });
        });
    });
});