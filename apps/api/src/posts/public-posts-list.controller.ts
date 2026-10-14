import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { LIST_LIMIT } from '../rate-limit/rate-limit.config.js';
import { ListPostsQuery } from './dto/list-posts.query.js';
import type { Paginated } from './pagination.js';
import { PostsListService } from './posts-list.service.js';
import type { PublicPostListItem } from './posts-list.types.js';

// Read-only on purpose. It shares the /posts prefix with GET /posts/:slug without clashing,
// because ":slug" never matches an empty path.
@Public()
@Controller('posts')
export class PublicPostsListController {
    constructor(private readonly lists: PostsListService) { }

    @Get()
    @Throttle({ default: LIST_LIMIT })
    list(@Query() query: ListPostsQuery): Promise<Paginated<PublicPostListItem>> {
        return this.lists.listPublished(query);
    }
}