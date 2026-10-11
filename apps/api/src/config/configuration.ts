import { EnvironmentVariables, NodeEnv, validateEnv } from './env.validation.js';

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

/** Pure: turns validated env values into the grouped, typed settings the app reads. */
export function buildConfiguration(env: EnvironmentVariables) {
    return {
        app: {
            nodeEnv: env.NODE_ENV,
            port: env.PORT,
            corsOrigin: stripTrailingSlashes(env.CORS_ORIGIN),
            trustProxyHops: env.TRUST_PROXY_HOPS,
        },
        database: {
            url: env.DATABASE_URL,
        },
        auth: {
            accessSecret: env.JWT_ACCESS_SECRET,
            accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
            refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
            // Cookies marked Secure are only sent over HTTPS, so only enable that in production
            cookieSecure: env.NODE_ENV === NodeEnv.Production,
        },
        redis: {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            password: env.REDIS_PASSWORD,
        },
        storage: {
            endpoint: env.S3_ENDPOINT ? stripTrailingSlashes(env.S3_ENDPOINT) : undefined,
            region: env.S3_REGION,
            bucket: env.S3_BUCKET,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true', // a real boolean from here on
        },
    };
}

export const configuration = () => buildConfiguration(validateEnv(process.env));

export type AppConfig = ReturnType<typeof buildConfiguration>;