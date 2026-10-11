import { NodeEnv, validateEnv } from './env.validation.js';

const base = {
    DATABASE_URL: 'mysql://root:root@localhost:3308/blogcms',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minio-dev-password',
};

const without = (key: string) => Object.fromEntries(Object.entries(base).filter(([k]) => k !== key));

describe('validateEnv', () => {
    describe('defaults and conversion', () => {
        it('applies defaults when only the required values are set', () => {
            const env = validateEnv(base);

            expect(env.NODE_ENV).toBe(NodeEnv.Development);
            expect(env.PORT).toBe(3001);
            expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
            expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
            expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
            expect(env.TRUST_PROXY_HOPS).toBe(0);
            expect(env.REDIS_HOST).toBe('localhost');
            expect(env.REDIS_PORT).toBe(6379);
            expect(env.REDIS_PASSWORD).toBeUndefined();
            expect(env.S3_ENDPOINT).toBeUndefined();
            expect(env.S3_REGION).toBe('us-east-1');
            expect(env.S3_BUCKET).toBe('blogcms-uploads');
            expect(env.S3_FORCE_PATH_STYLE).toBe('true');
        });

        it('converts numeric strings to numbers', () => {
            const env = validateEnv({
                ...base,
                PORT: '4000',
                JWT_ACCESS_TTL_SECONDS: '600',
                REFRESH_TOKEN_TTL_DAYS: '30',
                TRUST_PROXY_HOPS: '1',
                REDIS_PORT: '6380',
            });

            expect(env.PORT).toBe(4000);
            expect(env.JWT_ACCESS_TTL_SECONDS).toBe(600);
            expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
            expect(env.TRUST_PROXY_HOPS).toBe(1);
            expect(env.REDIS_PORT).toBe(6380);
        });
    });

    describe('required values', () => {
        it.each(['DATABASE_URL', 'JWT_ACCESS_SECRET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])(
            'throws when %s is missing',
            (key) => {
                expect(() => validateEnv(without(key))).toThrow(new RegExp(key));
            },
        );

        it('reports every problem at once instead of one at a time', () => {
            expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*S3_ACCESS_KEY_ID/);
        });
    });

    describe('database and general settings', () => {
        it('throws when DATABASE_URL is not a mysql url', () => {
            expect(() => validateEnv({ ...base, DATABASE_URL: 'postgres://x' })).toThrow(/mysql:\/\//);
        });

        it('throws when NODE_ENV is not a known value', () => {
            expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
        });

        it.each(['0', '70000', 'abc'])('throws when PORT is %p', (port) => {
            expect(() => validateEnv({ ...base, PORT: port })).toThrow(/PORT/);
        });

        it.each(['-1', '6', '1.5', 'many'])('throws when TRUST_PROXY_HOPS is %p', (hops) => {
            expect(() => validateEnv({ ...base, TRUST_PROXY_HOPS: hops })).toThrow(/TRUST_PROXY_HOPS/);
        });
    });

    describe('auth secrets', () => {
        it('throws when the JWT secret is too short', () => {
            expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
        });

        it('throws when the JWT secret is still the placeholder', () => {
            expect(() =>
                validateEnv({ ...base, JWT_ACCESS_SECRET: 'change-me-generate-with-openssl-rand-hex-48' }),
            ).toThrow(/placeholder/);
        });

        it.each(['30', '7200', 'abc'])('throws when the access TTL is %p', (ttl) => {
            expect(() => validateEnv({ ...base, JWT_ACCESS_TTL_SECONDS: ttl })).toThrow(
                /JWT_ACCESS_TTL_SECONDS/,
            );
        });

        it.each(['0', '91', 'abc'])('throws when the refresh TTL is %p', (days) => {
            expect(() => validateEnv({ ...base, REFRESH_TOKEN_TTL_DAYS: days })).toThrow(
                /REFRESH_TOKEN_TTL_DAYS/,
            );
        });
    });

    describe('Redis', () => {
        it('reads the password when one is set', () => {
            expect(validateEnv({ ...base, REDIS_PASSWORD: 'p@ss/word' }).REDIS_PASSWORD).toBe('p@ss/word');
        });

        it('treats an empty password as not set', () => {
            expect(validateEnv({ ...base, REDIS_PASSWORD: '' }).REDIS_PASSWORD).toBeUndefined();
        });

        it('rejects an empty host', () => {
            expect(() => validateEnv({ ...base, REDIS_HOST: '' })).toThrow(/REDIS_HOST/);
        });

        it.each(['0', '70000', 'abc'])('throws when REDIS_PORT is %p', (port) => {
            expect(() => validateEnv({ ...base, REDIS_PORT: port })).toThrow(/REDIS_PORT/);
        });
    });

    describe('S3 storage', () => {
        it.each(['http://localhost:9000', 'https://s3.eu-west-1.amazonaws.com'])(
            'accepts the endpoint %p',
            (endpoint) => {
                expect(validateEnv({ ...base, S3_ENDPOINT: endpoint }).S3_ENDPOINT).toBe(endpoint);
            },
        );

        it('treats an empty endpoint as not set (real AWS)', () => {
            expect(validateEnv({ ...base, S3_ENDPOINT: '' }).S3_ENDPOINT).toBeUndefined();
        });

        it.each(['not a url', 'ftp://minio:9000'])('rejects the endpoint %p', (endpoint) => {
            expect(() => validateEnv({ ...base, S3_ENDPOINT: endpoint })).toThrow(/S3_ENDPOINT/);
        });

        it.each(['us-east-1', 'eu-west-3', 'ap-southeast-2', 'us-gov-west-1'])('accepts the region %p', (region) => {
            expect(validateEnv({ ...base, S3_REGION: region }).S3_REGION).toBe(region);
        });

        it.each(['US_EAST', 'useast1', 'us-east', ''])('rejects the region %p', (region) => {
            expect(() => validateEnv({ ...base, S3_REGION: region })).toThrow(/S3_REGION/);
        });

        it.each(['my-bucket', 'blog123', 'a1b', 'a'.repeat(63)])('accepts the bucket name %p', (bucket) => {
            expect(validateEnv({ ...base, S3_BUCKET: bucket }).S3_BUCKET).toBe(bucket);
        });

        it.each(['ab', 'UPPER', '-start', 'end-', 'has_underscore', 'has.dot', 'a'.repeat(64)])(
            'rejects the bucket name %p',
            (bucket) => {
                expect(() => validateEnv({ ...base, S3_BUCKET: bucket })).toThrow(/S3_BUCKET/);
            },
        );

        it('rejects a secret key shorter than 8 characters', () => {
            expect(() => validateEnv({ ...base, S3_SECRET_ACCESS_KEY: 'short' })).toThrow(
                /S3_SECRET_ACCESS_KEY/,
            );
        });

        it.each(['true', 'false'])('accepts S3_FORCE_PATH_STYLE=%s and keeps it as text', (value) => {
            expect(validateEnv({ ...base, S3_FORCE_PATH_STYLE: value }).S3_FORCE_PATH_STYLE).toBe(value);
        });

        it.each(['yes', 'TRUE', '1', ''])('rejects S3_FORCE_PATH_STYLE=%p', (value) => {
            expect(() => validateEnv({ ...base, S3_FORCE_PATH_STYLE: value })).toThrow(/S3_FORCE_PATH_STYLE/);
        });
    });
});