import type { Prisma } from '@prisma/client';

// What the author (or an admin) sees. The response IS this select, so no extra column can leak.
export const managePostSelect = {
    id: true,
    slug: true,
    title: true,
    excerpt: true,
    content: true,
    status: true,
    publishedAt: true,
    coverImageId: true,
    createdAt: true,
    updatedAt: true,
    author: { select: { id: true, name: true } },
} satisfies Prisma.PostSelect;

export type ManagePost = Prisma.PostGetPayload<{ select: typeof managePostSelect }>;

// What the public sees: no ids, no status, no email, only the author's display name.
// coverImageId is the name of a publicly readable image, so it is fine to show.
export const publicPostSelect = {
    slug: true,
    title: true,
    excerpt: true,
    content: true,
    coverImageId: true,
    publishedAt: true,
    updatedAt: true,
    author: { select: { name: true } },
} satisfies Prisma.PostSelect;

export type PublicPost = Prisma.PostGetPayload<{ select: typeof publicPostSelect }>;