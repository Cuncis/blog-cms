import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { trimToNull } from './transforms.js';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_PAGE = 10_000;
export const MAX_LIMIT = 50;
export const SEARCH_MAX = 100;

export class ListPostsQuery {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_PAGE)
    page: number = DEFAULT_PAGE;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_LIMIT)
    limit: number = DEFAULT_LIMIT;

    // "?q=" (an empty search box) means "no search", not "search for nothing"
    @Transform(trimToNull)
    @IsOptional()
    @IsString()
    @MaxLength(SEARCH_MAX)
    q?: string | null;
}