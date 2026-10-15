import { vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { CLEANUP_INTERVAL_MS, UploadCleanupScheduler } from './upload-cleanup.scheduler.js';
import type { UploadCleanupService } from './upload-cleanup.service.js';

describe('UploadCleanupScheduler', () => {
    const runOnce = vi.fn();
    const createScheduler = () => new UploadCleanupScheduler({ runOnce } as unknown as UploadCleanupService);

    beforeAll(() => {
        Logger.overrideLogger(false); // keep test output clean
    });

    beforeEach(() => {
        vi.useFakeTimers();
        runOnce.mockReset();
        runOnce.mockResolvedValue({ removed: 0, skipped: 0 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('runs the cleanup on every interval, and stops when the module is destroyed', async () => {
        const scheduler = createScheduler();
        scheduler.onApplicationBootstrap();

        await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS - 1);
        expect(runOnce).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(runOnce).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
        expect(runOnce).toHaveBeenCalledTimes(2);

        scheduler.onModuleDestroy();
        await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS * 3);
        expect(runOnce).toHaveBeenCalledTimes(2);
    });

    it('never lets two runs overlap', async () => {
        let release!: () => void;
        runOnce.mockReturnValueOnce(
            new Promise((resolve) => {
                release = () => resolve({ removed: 0, skipped: 0 });
            }),
        );

        const scheduler = createScheduler();
        const first = scheduler.tick();
        await scheduler.tick(); // returns at once: the first run is still going

        expect(runOnce).toHaveBeenCalledTimes(1);

        release();
        await first;
        await scheduler.tick();

        expect(runOnce).toHaveBeenCalledTimes(2);
    });

    it('keeps running after a failed run', async () => {
        runOnce.mockRejectedValueOnce(new Error('database down'));
        const scheduler = createScheduler();

        await expect(scheduler.tick()).resolves.toBeUndefined();
        await scheduler.tick();

        expect(runOnce).toHaveBeenCalledTimes(2);
    });
});