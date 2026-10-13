import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CONTENT_MAX, EXCERPT_MAX, TITLE_MAX } from '../posts.constants.js';
import { trim, trimToNull } from './transforms.js';

// There is no status, slug, or authorId. The global ValidationPipe (forbidNonWhitelisted)
// turns any of them into a 400: posts always start as drafts, slugs come from the title,
// and the author is whoever is logged in.
export class CreatePostDto {
    @Transform(trim)
    @IsString()
    @IsNotEmpty({ message: 'title should not be empty' })
    @MaxLength(TITLE_MAX)
    title!: string;

    @Transform(trimToNull)
    @IsOptional()
    @IsString()
    @MaxLength(EXCERPT_MAX)
    excerpt?: string | null;

    @Transform(trim)
    @IsString()
    @IsNotEmpty({ message: 'content should not be empty' })
    @MaxLength(CONTENT_MAX)
    content!: string;
}