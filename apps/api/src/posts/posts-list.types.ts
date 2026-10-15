import type { Prisma } from '@prisma/client';

// One select for both lists. There is deliberately no `content`: lists return summaries.
// `id` is needed internally to keep search results in relevance order. The public mapping drops it.
export const listSelect = {
    id: true,
    slug: true,
    title: true,
    excerpt: true,
    coverImageId: true,
    status: true,
    publishedAt: true,
    createdAt: true,
    updatedAt: true,
    author: { select: { id: true, name: true } },
} satisfies Prisma.PostSelect;

export type ListRow = Prisma.PostGetPayload<{ select: typeof listSelect }>;

// What the public sees: no ids, no status, no email, only the author's display name
export type PublicPostListItem = {
    slug: string;
    title: string;
    excerpt: string | null;
    coverImageId: string | null;
    publishedAt: Date | null;
    author: { name: string };
};

export function toPublicItem(row: ListRow): PublicPostListItem {
    return {
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        coverImageId: row.coverImageId,
        publishedAt: row.publishedAt,
        author: { name: row.author.name },
    };
}