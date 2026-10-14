import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import type { Serialized } from '../cache/serialize.js';
import { LIST_LIMIT } from '../rate-limit/rate-limit.config.js';
import { ListPostsQuery } from './dto/list-posts.query.js';
import type { Paginated } from './pagination.js';
import type { PublicPostListItem } from './posts-list.types.js';
import { PublicPostsReader } from './public-posts.reader.js';

// Read-only on purpose. It shares the /posts prefix with GET /posts/:slug without clashing,
// because ":slug" never matches an empty path.
@Public()
@Controller('posts')
export class PublicPostsListController {
    constructor(private readonly posts: PublicPostsReader) { }

    @Get()
    @Throttle({ default: LIST_LIMIT })
    list(@Query() query: ListPostsQuery): Promise<Serialized<Paginated<PublicPostListItem>>> {
        return this.posts.listPublished(query);
    }
}