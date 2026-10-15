import { Inject, Injectable, Logger } from '@nestjs/common';
import { UploadStatus } from '@prisma/client';
import { isForeignKeyViolation } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage.js';
import {
    coverKey,
    PENDING_MAX_AGE_MS,
    tempKey,
    UNATTACHED_MAX_AGE_MS,
} from './uploads.constants.js';
import type { CleanupResult } from './uploads.types.js';

export const CLEANUP_BATCH = 100;

@Injectable()
export class UploadCleanupService {
    private readonly logger = new Logger(UploadCleanupService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    ) { }

    /**
     * Removes tickets nobody finished, and confirmed images no post uses. A batch per run,
     * oldest first. Safe to run at any time, from any number of instances.
     */
    async runOnce(now: Date = new Date()): Promise<CleanupResult> {
        const stalePending = await this.prisma.upload.findMany({
            where: {
                status: UploadStatus.PENDING,
                createdAt: { lt: new Date(now.getTime() - PENDING_MAX_AGE_MS) },
            },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
            take: CLEANUP_BATCH,
        });

        const unattached = await this.prisma.upload.findMany({
            where: {
                status: UploadStatus.CONFIRMED,
                confirmedAt: { lt: new Date(now.getTime() - UNATTACHED_MAX_AGE_MS) },
                coverOf: { is: null },
            },
            select: { id: true },
            orderBy: { confirmedAt: 'asc' },
            take: CLEANUP_BATCH,
        });

        let removed = 0;
        let skipped = 0;

        for (const { id } of [...stalePending, ...unattached]) {
            // The row goes FIRST. If a post claimed it a moment ago, the database refuses (foreign key
            // RESTRICT) and we leave everything alone. Deleting the objects first could destroy a live image.
            if (!(await this.deleteRow(id))) {
                skipped += 1;
                continue;
            }

            await this.deleteObjects(id);
            removed += 1;
        }

        if (removed > 0) this.logger.log(`Removed ${removed} stale upload(s)`);

        return { removed, skipped };
    }

    private async deleteRow(id: string): Promise<boolean> {
        try {
            const { count } = await this.prisma.upload.deleteMany({ where: { id, coverOf: { is: null } } });

            return count === 1;
        } catch (error) {
            if (isForeignKeyViolation(error)) return false; // it just became a post's cover
            throw error;
        }
    }

    private async deleteObjects(id: string): Promise<void> {
        // Both keys, always: a ticket never confirmed has only tmp/, a confirmed one has covers/
        // (and maybe a leftover tmp/). Deleting a key that does not exist is not an error.
        const results = await Promise.allSettled([
            this.storage.delete(tempKey(id)),
            this.storage.delete(coverKey(id)),
        ]);

        for (const result of results) {
            if (result.status === 'rejected') {
                const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
                this.logger.warn(`Could not delete an object of upload ${id}: ${reason}`);
            }
        }
    }
}