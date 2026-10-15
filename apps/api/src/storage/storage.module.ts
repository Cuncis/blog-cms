import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { OBJECT_STORAGE } from './object-storage.js';
import { createS3Client, S3_CLIENT, S3Storage } from './s3.storage.js';

@Module({
    providers: [
        {
            provide: S3_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService<AppConfig, true>) => createS3Client(config),
        },
        S3Storage,
        { provide: OBJECT_STORAGE, useExisting: S3Storage },
    ],
    exports: [OBJECT_STORAGE],
})
export class StorageModule { }