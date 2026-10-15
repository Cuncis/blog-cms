import {
    CopyObjectCommand,
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    PutBucketPolicyCommand,
    S3Client,
    type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import {
    Inject,
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { NodeEnv } from '../config/env.validation.js';
import {
    ObjectChangedError,
    type CopyRequest,
    type ObjectStorage,
    type PresignedUpload,
    type PresignRequest,
    type StoredObject,
} from './object-storage.js';
import { publicReadPolicy } from './public-read-policy.js';
import { httpStatusOf, isBucketAlreadyOwnedError, isNotFoundError } from './s3-errors.js';

export const S3_CLIENT = Symbol('S3_CLIENT');

const OPERATION_TIMEOUT_MS = 10_000;
const DEFAULT_REGION = 'us-east-1';

// A new AbortSignal per call: every storage operation has a deadline, so a stuck connection
// can't hang a request forever
const deadline = () => ({ abortSignal: AbortSignal.timeout(OPERATION_TIMEOUT_MS) });

export function createS3Client(config: ConfigService<AppConfig, true>): S3Client {
    const storage = config.get('storage', { infer: true });

    return new S3Client({
        region: storage.region,
        endpoint: storage.endpoint, // undefined means real AWS
        forcePathStyle: storage.forcePathStyle,
        credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
        // Recent SDK versions add checksum headers that some S3-compatible servers reject.
        // This only adds them when an operation requires them.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        maxAttempts: 2,
    });
}

@Injectable()
export class S3Storage implements ObjectStorage, OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(S3Storage.name);
    private readonly bucket: string;
    private readonly region: string;
    private readonly isProduction: boolean;

    constructor(
        @Inject(S3_CLIENT) private readonly client: S3Client,
        config: ConfigService<AppConfig, true>,
    ) {
        const storage = config.get('storage', { infer: true });

        this.bucket = storage.bucket;
        this.region = storage.region;
        this.isProduction = config.get('app.nodeEnv', { infer: true }) === NodeEnv.Production;
    }

    onApplicationBootstrap(): void {
        // Deliberately not awaited: startup never waits for (or fails because of) storage
        void this.prepare();
    }

    onModuleDestroy(): void {
        this.client.destroy();
    }

    /**
     * Development: creates the bucket if it is missing and makes covers/ publicly readable.
     * Production: only checks the bucket exists, because infrastructure code owns buckets and policies.
     * Never throws: with storage down the API still serves every page that doesn't need it.
     */
    async prepare(): Promise<void> {
        try {
            if (!(await this.bucketExists())) {
                if (this.isProduction) {
                    this.logger.error(`Bucket "${this.bucket}" does not exist. Create it with your infrastructure tooling.`);
                    return;
                }

                await this.createBucket();
            }

            if (!this.isProduction) {
                await this.client.send(
                    new PutBucketPolicyCommand({
                        Bucket: this.bucket,
                        Policy: JSON.stringify(publicReadPolicy(this.bucket)),
                    }),
                    deadline(),
                );
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Storage is not ready: ${reason}. Uploads will fail until it is.`);
        }
    }

    async presignedPost({ key, contentType, size, expiresInSeconds }: PresignRequest): Promise<PresignedUpload> {
        const { url, fields } = await createPresignedPost(this.client, {
            Bucket: this.bucket,
            Key: key,
            Conditions: [
                // The storage server itself rejects any file that is not exactly the announced size...
                ['content-length-range', size, size],
                // ...or that is sent with a different content type
                ['eq', '$Content-Type', contentType],
            ],
            Fields: { 'Content-Type': contentType },
            Expires: expiresInSeconds,
        });

        return { url, fields };
    }

    async head(key: string): Promise<StoredObject | null> {
        try {
            const result = await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
                deadline(),
            );

            if (!result.ETag) throw new Error('Storage returned no ETag');

            return { size: result.ContentLength ?? 0, contentType: result.ContentType, etag: result.ETag };
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    }

    async readStart(key: string, length: number): Promise<Uint8Array> {
        const result = await this.client.send(
            new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${length - 1}` }),
            deadline(),
        );

        return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
    }

    async copy({ from, to, etag, contentType, cacheControl }: CopyRequest): Promise<void> {
        try {
            await this.client.send(
                new CopyObjectCommand({
                    Bucket: this.bucket,
                    Key: to,
                    // Our keys are made of a prefix and a UUID, so they need no URL encoding here
                    CopySource: `${this.bucket}/${from}`,
                    // Copy only the exact bytes we inspected. If the client re-uploaded in the meantime,
                    // the ETag differs and the storage server answers 412.
                    CopySourceIfMatch: etag,
                    MetadataDirective: 'REPLACE',
                    ContentType: contentType,
                    CacheControl: cacheControl,
                }),
                deadline(),
            );
        } catch (error) {
            if (httpStatusOf(error) === 412 || isNotFoundError(error)) throw new ObjectChangedError();
            throw error;
        }
    }

    async delete(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), deadline());
    }

    private async bucketExists(): Promise<boolean> {
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), deadline());
            return true;
        } catch (error) {
            if (isNotFoundError(error)) return false;
            throw error;
        }
    }

    private async createBucket(): Promise<void> {
        try {
            await this.client.send(
                new CreateBucketCommand({
                    Bucket: this.bucket,
                    // Every region except us-east-1 must be named explicitly
                    CreateBucketConfiguration:
                        this.region === DEFAULT_REGION
                            ? undefined
                            : { LocationConstraint: this.region as BucketLocationConstraint },
                }),
                deadline(),
            );
            this.logger.log(`Created bucket "${this.bucket}"`);
        } catch (error) {
            if (isBucketAlreadyOwnedError(error)) return; // another instance won the race
            throw error;
        }
    }
}