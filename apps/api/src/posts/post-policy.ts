import { PostStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';

/**
 * Admins manage every post, editors manage their own, everyone else manages nothing.
 * Checking the role here (and not only in the guard) means a mistake in route setup can't
 * hand a reader the power to edit.
 */
export function canManagePost(actor: AuthenticatedUser, post: { author: { id: string } }): boolean {
    if (actor.role === Role.ADMIN) return true;

    return actor.role === Role.EDITOR && post.author.id === actor.id;
}

/**
 * The only place that decides publishedAt: set exactly when a post is published,
 * cleared exactly when it is not. status and publishedAt always travel together.
 */
export function publicationFields(
    status: PostStatus,
    now: Date,
): { status: PostStatus; publishedAt: Date | null } {
    return status === PostStatus.PUBLISHED ? { status, publishedAt: now } : { status, publishedAt: null };
}