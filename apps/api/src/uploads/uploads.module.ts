import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { UploadCleanupScheduler } from './upload-cleanup.scheduler.js';
import { UploadCleanupService } from './upload-cleanup.service.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({
    imports: [StorageModule],
    controllers: [UploadsController],
    providers: [UploadsService, UploadCleanupService, UploadCleanupScheduler],
})
export class UploadsModule { }