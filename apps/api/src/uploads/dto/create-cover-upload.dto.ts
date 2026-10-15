import { IsIn, IsInt, Max, Min } from 'class-validator';
import { ALLOWED_COVER_TYPES, MAX_COVER_BYTES, type CoverContentType } from '../uploads.constants.js';

// There is no key, userId, or bucket here. The global ValidationPipe (forbidNonWhitelisted)
// turns any of them into a 400: the server decides where files go and who owns them.
export class CreateCoverUploadDto {
    @IsIn(ALLOWED_COVER_TYPES, {
        message: `contentType must be one of: ${ALLOWED_COVER_TYPES.join(', ')}`,
    })
    contentType!: CoverContentType;

    @IsInt()
    @Min(1)
    @Max(MAX_COVER_BYTES, { message: `size must be at most ${MAX_COVER_BYTES} bytes` })
    size!: number;
}