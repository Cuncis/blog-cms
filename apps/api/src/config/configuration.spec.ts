import { buildConfiguration } from './configuration.js';
import { NodeEnv, validateEnv } from './env.validation.js';

const base = {
    DATABASE_URL: 'mysql://root:root@localhost:3308/blogcms',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minio-dev-password',
};

const build = (overrides: Record<string, unknown> = {}) =>
    buildConfiguration(validateEnv({ ...base, ...overrides }));

describe('buildConfiguration', () => {
    it('groups the validated values into typed settings', () => {
        const config = build({
            NODE_ENV: 'test',
            PORT: '4000',
            REDIS_PASSWORD: 'secret',
            S3_ENDPOINT: 'http://localhost:9000',
        });

        expect(config.app).toEqual({
            nodeEnv: NodeEnv.Test,
            port: 4000,
            corsOrigin: 'http://localhost:3000',
            trustProxyHops: 0,
        });
        expect(config.database.url).toBe(base.DATABASE_URL);
        expect(config.auth).toMatchObject({
            accessSecret: base.JWT_ACCESS_SECRET,
            accessTtlSeconds: 900,
            refreshTtlDays: 7,
        });
        expect(config.redis).toEqual({ host: 'localhost', port: 6379, password: 'secret' });
        expect(config.storage).toEqual({
            endpoint: 'http://localhost:9000',
            region: 'us-east-1',
            bucket: 'blogcms-uploads',
            accessKeyId: 'minioadmin',
            secretAccessKey: 'minio-dev-password',
            forcePathStyle: true,
        });
    });

    it('turns S3_FORCE_PATH_STYLE into a real boolean, so "false" really means false', () => {
        expect(build({ S3_FORCE_PATH_STYLE: 'true' }).storage.forcePathStyle).toBe(true);
        expect(build({ S3_FORCE_PATH_STYLE: 'false' }).storage.forcePathStyle).toBe(false);
    });

    it('strips trailing slashes so building URLs by concatenation is safe', () => {
        const config = build({
            CORS_ORIGIN: 'http://localhost:3000/',
            S3_ENDPOINT: 'http://localhost:9000//',
        });

        expect(config.app.corsOrigin).toBe('http://localhost:3000');
        expect(config.storage.endpoint).toBe('http://localhost:9000');
    });

    it('leaves the endpoint undefined for real AWS', () => {
        expect(build().storage.endpoint).toBeUndefined();
        expect(build({ S3_ENDPOINT: '' }).storage.endpoint).toBeUndefined();
    });

    it('leaves the Redis password undefined when none is set', () => {
        expect(build().redis.password).toBeUndefined();
    });

    it('marks cookies Secure only in production', () => {
        expect(build({ NODE_ENV: 'production' }).auth.cookieSecure).toBe(true);
        expect(build({ NODE_ENV: 'development' }).auth.cookieSecure).toBe(false);
        expect(build({ NODE_ENV: 'test' }).auth.cookieSecure).toBe(false);
    });
});