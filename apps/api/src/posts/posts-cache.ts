// Everything the public can see lives in this one scope, so one version bump retires it all
export const PUBLIC_POSTS_SCOPE = 'posts';

// A single post changes rarely. Lists change whenever anything is published.
// These are also the upper bound on staleness when an invalidation could not reach Redis.
export const POST_TTL_SECONDS = 120;
export const LIST_TTL_SECONDS = 60;

export const postCacheName = (slug: string) => `post:${slug}`;

/**
 * Built only from numbers and sanitized search terms, never from raw user text.
 * The terms are sorted, because "redis cache" and "cache redis" are the same search.
 */
export function listCacheName(page: number, limit: number, terms: readonly string[]): string {
    return `list:p${page}:l${limit}:q${[...terms].sort().join('+')}`;
}