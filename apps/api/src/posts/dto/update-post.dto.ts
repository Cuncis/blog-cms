import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CONTENT_MAX, EXCERPT_MAX, TITLE_MAX } from '../posts.constants.js';
import { trim, trimToNull } from './transforms.js';

const whenProvided = (_object: unknown, value: unknown) => value !== undefined;

export class UpdatePostDto {
    // ValidateIf, not IsOptional: IsOptional would also let null through, and a title can't be cleared
    @ValidateIf(whenProvided)
    @Transform(trim)
    @IsString()
    @IsNotEmpty({ message: 'title should not be empty' })
    @MaxLength(TITLE_MAX)
    title?: string;

    // null (or an empty string) clears the excerpt; leaving the field out keeps it
    @Transform(trimToNull)
    @IsOptional()
    @IsString()
    @MaxLength(EXCERPT_MAX)
    excerpt?: string | null;

    @ValidateIf(whenProvided)
    @Transform(trim)
    @IsString()
    @IsNotEmpty({ message: 'content should not be empty' })
    @MaxLength(CONTENT_MAX)
    content?: string;
}