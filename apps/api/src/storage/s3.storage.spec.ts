import { vi } from 'vitest';
import {
    CopyObjectCommand,
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    PutBucketPolicyCommand,
    type S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { ObjectChangedError } from './object-storage.js';
import { createS3Client, S3Storage } from './s3.storage.js';

type Input = Record<string, unknown>;
type Handlers = Record<string, (input: Input) => unknown>;
type SentCommand = { constructor: { name: string }; input: Input };

const sdkError = (name: string, status: number) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

const storageSettings = (region = 'us-east-1') => ({
    endpoint: 'http://localhost:9000',
    region,
    bucket: 'test-bucket',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minio-dev-password',
    forcePathStyle: true,
});

const configWith = (nodeEnv: string, region?: string) => {
    const values: Record<string, unknown> = { storage: storageSettings(region), 'app.nodeEnv': nodeEnv };

    return { get: (key: string) => values[key] } as unknown as ConfigService<AppConfig, true>;
};

function setup(handlers: Handlers = {}, options: { nodeEnv?: string; region?: string } = {}) {
    const { nodeEnv = 'development', region } = options;

    const send = vi.fn(async (command: SentCommand) => handlers[command.constructor.name]?.(command.input) ?? {});
    const destroy = vi.fn();
    const storage = new S3Storage({ send, destroy } as unknown as S3Client, configWith(nodeEnv, region));

    const sent = () => send.mock.calls.map(([command]) => command);
    const names = () => sent().map((command) => command.constructor.name);

    return { storage, send, destroy, sent, names };
}

describe('S3Storage', () => {
    beforeAll(() => {
        Logger.overrideLogger(false); // keep test output clean
    });

    describe('head', () => {
        it('returns the size, content type, and ETag of the stored object', async () => {
            const { storage, sent } = setup({
                HeadObjectCommand: () => ({ ContentLength: 1234, ContentType: 'image/png', ETag: '"abc"' }),
            });

            await expect(storage.head('tmp/abc')).resolves.toEqual({ size: 1234, contentType: 'image/png', etag: '"abc"' });
            expect(sent()[0]).toBeInstanceOf(HeadObjectCommand);
            expect(sent()[0]?.input).toEqual({ Bucket: 'test-bucket', Key: 'tmp/abc' });
        });

        it('returns null when the object does not exist', async () => {
            const { storage } = setup({
                HeadObjectCommand: () => {
                    throw sdkError('NotFound', 404);
                },
            });

            await expect(storage.head('tmp/missing')).resolves.toBeNull();
        });

        it('rethrows every other error', async () => {
            const { storage } = setup({
                HeadObjectCommand: () => {
                    throw sdkError('AccessDenied', 403);
                },
            });

            await expect(storage.head('tmp/abc')).rejects.toThrow('AccessDenied');
        });

        it('refuses an answer without an ETag, because the conditional copy depends on it', async () => {
            const { storage } = setup({ HeadObjectCommand: () => ({ ContentLength: 5 }) });

            await expect(storage.head('tmp/abc')).rejects.toThrow('no ETag');
        });
    });

    describe('readStart', () => {
        it('asks for exactly the first bytes and returns them', async () => {
            const { storage, sent } = setup({
                GetObjectCommand: () => ({ Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) } }),
            });

            await expect(storage.readStart('tmp/abc', 12)).resolves.toEqual(Uint8Array.from([1, 2, 3]));
            expect(sent()[0]).toBeInstanceOf(GetObjectCommand);
            expect(sent()[0]?.input).toEqual({ Bucket: 'test-bucket', Key: 'tmp/abc', Range: 'bytes=0-11' });
        });

        it('returns nothing when the response has no body', async () => {
            const { storage } = setup({ GetObjectCommand: () => ({}) });

            await expect(storage.readStart('tmp/abc', 12)).resolves.toEqual(new Uint8Array());
        });
    });

    describe('copy', () => {
        const request = {
            from: 'tmp/abc',
            to: 'covers/abc',
            etag: '"abc"',
            contentType: 'image/png',
            cacheControl: 'public, max-age=31536000, immutable',
        };

        it('copies only the exact bytes that were inspected, and sets clean metadata', async () => {
            const { storage, sent } = setup();

            await storage.copy(request);

            expect(sent()[0]).toBeInstanceOf(CopyObjectCommand);
            expect(sent()[0]?.input).toEqual({
                Bucket: 'test-bucket',
                Key: 'covers/abc',
                CopySource: 'test-bucket/tmp/abc',
                CopySourceIfMatch: '"abc"',
                MetadataDirective: 'REPLACE',
                ContentType: 'image/png',
                CacheControl: 'public, max-age=31536000, immutable',
            });
        });

        it.each([
            ['the ETag no longer matches (412)', sdkError('PreconditionFailed', 412)],
            ['the source disappeared (404)', sdkError('NoSuchKey', 404)],
        ])('reports an ObjectChangedError when %s', async (_label, error) => {
            const { storage } = setup({
                CopyObjectCommand: () => {
                    throw error;
                },
            });

            await expect(storage.copy(request)).rejects.toBeInstanceOf(ObjectChangedError);
        });

        it('rethrows every other error', async () => {
            const { storage } = setup({
                CopyObjectCommand: () => {
                    throw sdkError('InternalError', 500);
                },
            });

            const error = await storage.copy(request).catch((e: unknown) => e);

            expect(error).not.toBeInstanceOf(ObjectChangedError);
            expect((error as Error).message).toBe('InternalError');
        });
    });

    describe('delete', () => {
        it('deletes by bucket and key', async () => {
            const { storage, sent } = setup();

            await storage.delete('tmp/abc');

            expect(sent()[0]).toBeInstanceOf(DeleteObjectCommand);
            expect(sent()[0]?.input).toEqual({ Bucket: 'test-bucket', Key: 'tmp/abc' });
        });
    });

    describe('prepare', () => {
        const missingBucket: Handlers = {
            HeadBucketCommand: () => {
                throw sdkError('NotFound', 404);
            },
        };

        it('creates a missing bucket and makes covers/ publicly readable (development)', async () => {
            const { storage, names, sent } = setup(missingBucket);

            await storage.prepare();

            expect(names()).toEqual(['HeadBucketCommand', 'CreateBucketCommand', 'PutBucketPolicyCommand']);
            expect(sent()[1]).toBeInstanceOf(CreateBucketCommand);
            expect(sent()[1]?.input).toEqual({ Bucket: 'test-bucket' });
            expect(sent()[2]).toBeInstanceOf(PutBucketPolicyCommand);

            const policy = JSON.parse(String(sent()[2]?.input.Policy)) as {
                Statement: Array<{ Action: string[]; Resource: string[] }>;
            };
            expect(policy.Statement[0]?.Action).toEqual(['s3:GetObject']);
            expect(policy.Statement[0]?.Resource).toEqual(['arn:aws:s3:::test-bucket/covers/*']);
        });

        it('names the region when creating a bucket outside us-east-1', async () => {
            const { storage, sent } = setup(missingBucket, { region: 'eu-west-1' });

            await storage.prepare();

            expect(sent()[1]?.input).toEqual({
                Bucket: 'test-bucket',
                CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' },
            });
        });

        it('leaves an existing bucket alone but still applies the policy (development)', async () => {
            const { storage, names } = setup();

            await storage.prepare();

            expect(names()).toEqual(['HeadBucketCommand', 'PutBucketPolicyCommand']);
        });

        it('carries on when another instance created the bucket a moment earlier', async () => {
            const { storage, names } = setup({
                ...missingBucket,
                CreateBucketCommand: () => {
                    throw sdkError('BucketAlreadyOwnedByYou', 409);
                },
            });

            await storage.prepare();

            expect(names()).toEqual(['HeadBucketCommand', 'CreateBucketCommand', 'PutBucketPolicyCommand']);
        });

        it('only checks the bucket in production: no creating, no policy', async () => {
            const { storage, names } = setup({}, { nodeEnv: 'production' });

            await storage.prepare();

            expect(names()).toEqual(['HeadBucketCommand']);
        });

        it('does not create a missing bucket in production', async () => {
            const { storage, names } = setup(missingBucket, { nodeEnv: 'production' });

            await expect(storage.prepare()).resolves.toBeUndefined();
            expect(names()).toEqual(['HeadBucketCommand']);
        });

        it('never throws, even when storage is unreachable or access is denied', async () => {
            const { storage, names } = setup({
                HeadBucketCommand: () => {
                    throw sdkError('AccessDenied', 403);
                },
            });

            await expect(storage.prepare()).resolves.toBeUndefined();
            expect(names()).toEqual(['HeadBucketCommand']);
        });
    });

    describe('lifecycle', () => {
        it('starts preparing at bootstrap without making startup wait for it', async () => {
            const { storage, names } = setup();

            expect(storage.onApplicationBootstrap()).toBeUndefined();
            await new Promise((resolve) => setImmediate(resolve));

            expect(names()).toContain('HeadBucketCommand');
        });

        it('closes the client on shutdown', () => {
            const { storage, destroy } = setup();

            storage.onModuleDestroy();

            expect(destroy).toHaveBeenCalledTimes(1);
        });
    });

    describe('presignedPost (signed with a real client, no network involved)', () => {
        const config = configWith('development');
        const storage = new S3Storage(createS3Client(config), config);

        const sign = () =>
            storage.presignedPost({ key: 'tmp/abc', contentType: 'image/png', size: 1234, expiresInSeconds: 300 });

        const decodePolicy = (fields: Record<string, string>) => {
            const encoded = Object.entries(fields).find(([name]) => name.toLowerCase() === 'policy')?.[1] ?? '';

            return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
                expiration: string;
                conditions: unknown[];
            };
        };

        it('points at the bucket on the configured endpoint', async () => {
            const { url } = await sign();

            expect(url).toContain('localhost:9000');
            expect(url).toContain('test-bucket');
        });

        it('fixes the key and the content type in the form fields', async () => {
            const { fields } = await sign();

            expect(fields).toMatchObject({ key: 'tmp/abc', 'Content-Type': 'image/png' });
        });

        it('makes the storage server enforce the exact size and the exact content type', async () => {
            const { fields } = await sign();
            const policy = decodePolicy(fields);

            expect(policy.conditions).toEqual(
                expect.arrayContaining([
                    ['content-length-range', 1234, 1234],
                    ['eq', '$Content-Type', 'image/png'],
                ]),
            );
        });

        it('binds the policy to the bucket and the key', async () => {
            const { fields } = await sign();
            const text = JSON.stringify(decodePolicy(fields).conditions);

            expect(text).toContain('test-bucket');
            expect(text).toContain('tmp/abc');
        });

        it('expires when asked to', async () => {
            const { fields } = await sign();
            const lifetime = Date.parse(decodePolicy(fields).expiration) - Date.now();

            expect(lifetime).toBeGreaterThan(290_000);
            expect(lifetime).toBeLessThanOrEqual(301_000);
        });

        it('gives a different signature when the size changes', async () => {
            const a = await sign();
            const b = await storage.presignedPost({
                key: 'tmp/abc',
                contentType: 'image/png',
                size: 9999,
                expiresInSeconds: 300,
            });

            const signatureOf = (fields: Record<string, string>) =>
                Object.entries(fields).find(([name]) => name.toLowerCase() === 'x-amz-signature')?.[1];

            expect(signatureOf(a.fields)).toBeDefined();
            expect(signatureOf(a.fields)).not.toBe(signatureOf(b.fields));
        });
    });
});