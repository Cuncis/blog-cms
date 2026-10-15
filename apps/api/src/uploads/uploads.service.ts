import { randomUUID } from 'node:crypto';
import {
    ConflictException,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
    UnprocessableEntityException,
} from '@nestjs/common';
import { UploadStatus, type Upload } from '@prisma/client';
import { AUTH_REQUIRED_MESSAGE } from '../auth/auth.constants.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { isForeignKeyViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
    OBJECT_STORAGE,
    ObjectChangedError,
    type ObjectStorage,
    type StoredObject,
} from '../storage/object-storage.js';
import type { CreateCoverUploadDto } from './dto/create-cover-upload.dto.js';
import { detectImageType, MAGIC_BYTES_LENGTH } from './magic-bytes.js';
import {
    coverKey,
    COVER_CACHE_CONTROL,
    MAX_PENDING_UPLOADS,
    PENDING_MAX_AGE_MS,
    PRESIGN_TTL_SECONDS,
    STORAGE_UNAVAILABLE,
    tempKey,
    UPLOAD_NOT_FOUND,
} from './uploads.constants.js';
import type { ConfirmedUpload, CoverUploadTicket } from './uploads.types.js';

const NOT_UPLOADED_YET = 'No file has been uploaded for this ticket yet.';
const UPLOAD_EXPIRED = 'This upload has expired. Please upload the file again.';
const FILE_CHANGED = 'The file changed while it was being checked. Please upload it again.';
const TOO_MANY_PENDING = 'Too many unfinished uploads. Finish them, or wait a while, and try again.';

const toConfirmed = (upload: Pick<Upload, 'id' | 'contentType' | 'size'>): ConfirmedUpload => ({
    id: upload.id,
    contentType: upload.contentType,
    size: upload.size,
});

/** "image/png; charset=binary" -> "image/png" */
const normalizeContentType = (value: string | undefined): string =>
    (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

@Injectable()
export class UploadsService {
    private readonly logger = new Logger(UploadsService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    ) { }

    /** Step 1: records the ticket and signs a policy that lets the browser POST exactly one file. */
    async createCoverUpload(
        actor: AuthenticatedUser,
        dto: CreateCoverUploadDto,
        now: Date = new Date(),
    ): Promise<CoverUploadTicket> {
        const pending = await this.prisma.upload.count({
            where: {
                userId: actor.id,
                status: UploadStatus.PENDING,
                createdAt: { gt: new Date(now.getTime() - PENDING_MAX_AGE_MS) },
            },
        });

        if (pending >= MAX_PENDING_UPLOADS) {
            throw new HttpException(TOO_MANY_PENDING, HttpStatus.TOO_MANY_REQUESTS);
        }

        const id = randomUUID();

        try {
            await this.prisma.upload.create({
                data: { id, userId: actor.id, contentType: dto.contentType, size: dto.size },
            });
        } catch (error) {
            // A valid token for an account that no longer exists
            if (isForeignKeyViolation(error)) throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);
            throw error;
        }

        try {
            const { url, fields } = await this.storage.presignedPost({
                key: tempKey(id), // always the quarantine area, never a key the client chose
                contentType: dto.contentType,
                size: dto.size,
                expiresInSeconds: PRESIGN_TTL_SECONDS,
            });

            return { uploadId: id, url, fields, expiresInSeconds: PRESIGN_TTL_SECONDS };
        } catch (error) {
            this.logger.error(`Could not sign an upload policy: ${this.describe(error)}`);

            try {
                await this.prisma.upload.delete({ where: { id } });
            } catch {
                // Cleanup will reap it
            }

            throw new ServiceUnavailableException(STORAGE_UNAVAILABLE);
        }
    }

    /**
     * Step 3: inspects what is really in storage, and only then publishes it.
     * Safe to call again: a confirmed upload just returns its details.
     */
    async confirm(
        actor: AuthenticatedUser,
        uploadId: string,
        now: Date = new Date(),
    ): Promise<ConfirmedUpload> {
        // Scoped to the caller: someone else's upload looks exactly like a missing one
        const upload = await this.prisma.upload.findFirst({ where: { id: uploadId, userId: actor.id } });
        if (!upload) throw new NotFoundException(UPLOAD_NOT_FOUND);

        if (upload.status === UploadStatus.CONFIRMED) return toConfirmed(upload);

        // The same age the cleanup job uses, so confirm and cleanup never fight over one upload
        if (now.getTime() - upload.createdAt.getTime() > PENDING_MAX_AGE_MS) {
            throw new ConflictException(UPLOAD_EXPIRED);
        }

        const source = tempKey(upload.id);

        const stored = await this.guarded(() => this.storage.head(source));
        if (stored === null) throw new ConflictException(NOT_UPLOADED_YET); // the browser may still be uploading

        const problem = await this.inspect(upload, stored);
        if (problem !== null) {
            await this.discard(upload.id);
            throw new UnprocessableEntityException(problem);
        }

        try {
            await this.guarded(() =>
                this.storage.copy({
                    from: source,
                    to: coverKey(upload.id),
                    etag: stored.etag, // only the exact bytes we just inspected
                    contentType: upload.contentType,
                    cacheControl: COVER_CACHE_CONTROL,
                }),
            );
        } catch (error) {
            if (error instanceof ObjectChangedError) {
                await this.discard(upload.id);
                throw new ConflictException(FILE_CHANGED);
            }
            throw error;
        }

        const { count } = await this.prisma.upload.updateMany({
            where: { id: upload.id, status: UploadStatus.PENDING },
            data: { status: UploadStatus.CONFIRMED, confirmedAt: now },
        });

        if (count === 0) {
            // A concurrent confirm finished first (or the row was cleaned up)
            const current = await this.prisma.upload.findFirst({ where: { id: upload.id, userId: actor.id } });
            if (!current || current.status !== UploadStatus.CONFIRMED) throw new ConflictException(UPLOAD_EXPIRED);

            return toConfirmed(current);
        }

        // Only now that the verified copy exists and the row is confirmed
        await this.deleteTempQuietly(source);

        return toConfirmed(upload);
    }

    /** Returns what is wrong with the stored file, or null when it is exactly what was announced. */
    private async inspect(upload: Upload, stored: StoredObject): Promise<string | null> {
        if (stored.size !== upload.size) return 'The uploaded file is not the size that was announced.';

        if (normalizeContentType(stored.contentType) !== upload.contentType) {
            return 'The uploaded file has the wrong content type.';
        }

        const start = await this.guarded(() => this.storage.readStart(tempKey(upload.id), MAGIC_BYTES_LENGTH));

        // The declared type is only a claim: the bytes have to agree with it
        if (detectImageType(start) !== upload.contentType) {
            return 'The file is not a valid JPEG, PNG, or WebP image.';
        }

        return null;
    }

    /** Forgets a failed upload: row and quarantined file, best effort. */
    private async discard(id: string): Promise<void> {
        try {
            await this.prisma.upload.deleteMany({ where: { id, status: UploadStatus.PENDING } });
        } catch (error) {
            this.logger.warn(`Could not remove upload ${id}: ${this.describe(error)}`);
        }

        await this.deleteTempQuietly(tempKey(id));
    }

    private async deleteTempQuietly(key: string): Promise<void> {
        try {
            await this.storage.delete(key);
        } catch (error) {
            this.logger.warn(`Could not delete ${key}: ${this.describe(error)}`);
        }
    }

    /** Storage trouble becomes a 503. The details go to the log, never to the client. */
    private async guarded<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof ObjectChangedError) throw error;

            this.logger.error(`Storage operation failed: ${this.describe(error)}`);
            throw new ServiceUnavailableException(STORAGE_UNAVAILABLE);
        }
    }

    private describe(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}