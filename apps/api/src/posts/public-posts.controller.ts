import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { PostsService } from './posts.service.js';
import type { PublicPost } from './posts.types.js';

// Read-only on purpose: every write lives under /manage/posts
@Public()
@Controller('posts')
export class PublicPostsController {
    constructor(private readonly posts: PostsService) { }

    @Get(':slug')
    getBySlug(@Param('slug') slug: string): Promise<PublicPost> {
        return this.posts.getPublished(slug);
    }
}