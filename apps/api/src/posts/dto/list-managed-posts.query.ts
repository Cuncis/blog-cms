import { PostStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ListPostsQuery } from './list-posts.query.js';

// The public list takes no status: it only ever shows published posts.
export class ListManagedPostsQuery extends ListPostsQuery {
    @IsOptional()
    @IsEnum(PostStatus, { message: `status must be one of: ${Object.values(PostStatus).join(', ')}` })
    status?: PostStatus;
}