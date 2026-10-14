import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service.js';
import { toJson, type Serialized } from '../cache/serialize.js';
import type { ListPostsQuery } from './dto/list-posts.query.js';
import type { Paginated } from './pagination.js';
import {
    LIST_TTL_SECONDS,
    listCacheName,
    POST_TTL_SECONDS,
    postCacheName,
    PUBLIC_POSTS_SCOPE,
} from './posts-cache.js';
import { PostsListService } from './posts-list.service.js';
import type { PublicPostListItem } from './posts-list.types.js';
import { PostsService } from './posts.service.js';
import type { PublicPost } from './posts.types.js';
import { parseSearchTerms } from './search-query.js';
import { normalizeSlug } from './slug.util.js';

/** The public read path: Redis first, MySQL (through the existing services) on a miss. */
@Injectable()
export class PublicPostsReader {
    constructor(
        private readonly posts: PostsService,
        private readonly lists: PostsListService,
        private readonly cache: CacheService,
    ) { }

    async getPublished(rawSlug: string): Promise<Serialized<PublicPost>> {
        const slug = normalizeSlug(rawSlug);

        // An impossible slug never reaches Redis, so no junk keys. The service answers 404.
        if (slug === null) return toJson(await this.posts.getPublished(rawSlug));

        // Errors (a missing post or a draft is a 404) are never cached
        return this.cache.getOrLoad(PUBLIC_POSTS_SCOPE, postCacheName(slug), POST_TTL_SECONDS, () =>
            this.posts.getPublished(slug),
        );
    }

    async listPublished(query: ListPostsQuery): Promise<Serialized<Paginated<PublicPostListItem>>> {
        const terms = query.q ? parseSearchTerms(query.q) : [];

        // A search with nothing searchable in it is answered with 400 by the service: cache nothing for it
        if (query.q && terms.length === 0) return toJson(await this.lists.listPublished(query));

        return this.cache.getOrLoad(
            PUBLIC_POSTS_SCOPE,
            listCacheName(query.page, query.limit, terms),
            LIST_TTL_SECONDS,
            () => this.lists.listPublished(query),
        );
    }
}