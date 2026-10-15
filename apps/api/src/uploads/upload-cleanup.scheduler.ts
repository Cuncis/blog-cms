import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { UploadCleanupService } from './upload-cleanup.service.js';

export const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

/** Runs the cleanup on a timer. Every instance runs it, which is fine: it is idempotent. */
@Injectable()
export class UploadCleanupScheduler implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(UploadCleanupScheduler.name);
    private timer: NodeJS.Timeout | undefined;
    private running = false;

    constructor(private readonly cleanup: UploadCleanupService) { }

    onApplicationBootstrap(): void {
        this.timer = setInterval(() => void this.tick(), CLEANUP_INTERVAL_MS);
        this.timer.unref(); // a pending timer never keeps the process alive
    }

    onModuleDestroy(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    async tick(): Promise<void> {
        if (this.running) return; // never let two runs overlap

        this.running = true;
        try {
            await this.cleanup.runOnce();
        } catch (error) {
            this.logger.error(`Upload cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.running = false;
        }
    }
}