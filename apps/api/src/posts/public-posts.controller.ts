import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import type { Serialized } from '../cache/serialize.js';
import { PublicPostsReader } from './public-posts.reader.js';
import type { PublicPost } from './posts.types.js';

// Read-only on purpose: every write lives under /manage/posts
@Public()
@Controller('posts')
export class PublicPostsController {
    constructor(private readonly posts: PublicPostsReader) { }

    @Get(':slug')
    getBySlug(@Param('slug') slug: string): Promise<Serialized<PublicPost>> {
        return this.posts.getPublished(slug);
    }
}