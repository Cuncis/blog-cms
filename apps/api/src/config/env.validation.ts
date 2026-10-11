import { plainToInstance, Transform } from 'class-transformer';
import {
    IsEnum,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUrl,
    Matches,
    Max,
    Min,
    MinLength,
    validateSync,
} from 'class-validator';

export enum NodeEnv {
    Development = 'development',
    Test = 'test',
    Production = 'production',
}

// "KEY=" in a .env file arrives as an empty string. For optional settings that means "not set".
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class EnvironmentVariables {
    @IsEnum(NodeEnv)
    NODE_ENV: NodeEnv = NodeEnv.Development;

    @IsInt()
    @Min(1)
    @Max(65535)
    PORT: number = 3001;

    @IsString()
    @Matches(/^mysql:\/\/.+/, { message: 'DATABASE_URL must start with mysql://' })
    DATABASE_URL!: string;

    @IsUrl({ require_tld: false, require_protocol: true })
    CORS_ORIGIN: string = 'http://localhost:3000';

    // ---- Auth ----

    @IsString()
    @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
    @Matches(/^(?!change-me)/, {
        message: 'JWT_ACCESS_SECRET is still the placeholder. Generate one: openssl rand -hex 48',
    })
    JWT_ACCESS_SECRET!: string;

    // 1 minute to 1 hour: short lifetimes are the whole point of access tokens
    @IsInt()
    @Min(60)
    @Max(3600)
    JWT_ACCESS_TTL_SECONDS: number = 900;

    @IsInt()
    @Min(1)
    @Max(90)
    REFRESH_TOKEN_TTL_DAYS: number = 7;

    // Number of reverse proxies in front of the API (0 = clients connect directly)
    @IsInt()
    @Min(0)
    @Max(5)
    TRUST_PROXY_HOPS: number = 0;

    // ---- Redis ----

    @IsString()
    @IsNotEmpty()
    REDIS_HOST: string = 'localhost';

    @IsInt()
    @Min(1)
    @Max(65535)
    REDIS_PORT: number = 6379;

    @Transform(emptyToUndefined)
    @IsOptional()
    @IsString()
    REDIS_PASSWORD?: string;

    // ---- S3-compatible storage ----

    // Set for MinIO or another S3-compatible service. Leave out for real AWS S3.
    @Transform(emptyToUndefined)
    @IsOptional()
    @IsUrl({ protocols: ['http', 'https'], require_tld: false, require_protocol: true })
    S3_ENDPOINT?: string;

    @IsString()
    @Matches(/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/, {
        message: 'S3_REGION must look like us-east-1 or eu-west-3',
    })
    S3_REGION: string = 'us-east-1';

    // S3 bucket naming rules: 3-63 characters, lowercase letters, digits and hyphens,
    // starting and ending with a letter or digit
    @IsString()
    @Matches(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, {
        message:
            'S3_BUCKET must be 3-63 characters: lowercase letters, numbers and hyphens, starting and ending with a letter or number',
    })
    S3_BUCKET: string = 'blogcms-uploads';

    @IsString()
    @MinLength(3)
    S3_ACCESS_KEY_ID!: string;

    @IsString()
    @MinLength(8)
    S3_SECRET_ACCESS_KEY!: string;

    // A string on purpose: implicit conversion would turn the text "false" into the boolean true
    @IsIn(['true', 'false'], { message: 'S3_FORCE_PATH_STYLE must be "true" or "false"' })
    S3_FORCE_PATH_STYLE: string = 'true';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
    const validated = plainToInstance(EnvironmentVariables, config, {
        enableImplicitConversion: true, // "3001" -> 3001
    });

    const errors = validateSync(validated);

    if (errors.length > 0) {
        const details = errors
            .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
            .join('\n');
        throw new Error(`Invalid environment configuration:\n${details}`);
    }

    return validated;
}