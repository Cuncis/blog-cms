import { PostStatus, Role } from '@prisma/client';
import { canManagePost, publicationFields } from './post-policy.js';

const post = { author: { id: 'author-1' } };

describe('canManagePost', () => {
    it('lets an admin manage any post', () => {
        expect(canManagePost({ id: 'admin-1', role: Role.ADMIN }, post)).toBe(true);
    });

    it('lets an editor manage their own posts only', () => {
        expect(canManagePost({ id: 'author-1', role: Role.EDITOR }, post)).toBe(true);
        expect(canManagePost({ id: 'other', role: Role.EDITOR }, post)).toBe(false);
    });

    it('lets a reader manage nothing, not even a post they once wrote', () => {
        expect(canManagePost({ id: 'author-1', role: Role.READER }, post)).toBe(false);
        expect(canManagePost({ id: 'other', role: Role.READER }, post)).toBe(false);
    });
});

describe('publicationFields', () => {
    const now = new Date('2026-06-01T12:00:00Z');

    it('sets publishedAt when publishing', () => {
        expect(publicationFields(PostStatus.PUBLISHED, now)).toEqual({
            status: PostStatus.PUBLISHED,
            publishedAt: now,
        });
    });

    it('clears publishedAt when going back to draft', () => {
        expect(publicationFields(PostStatus.DRAFT, now)).toEqual({
            status: PostStatus.DRAFT,
            publishedAt: null,
        });
    });

    it('can never produce a published post without a date, or a draft with one', () => {
        for (const status of Object.values(PostStatus)) {
            const fields = publicationFields(status, now);

            expect(fields.status === PostStatus.PUBLISHED).toBe(fields.publishedAt !== null);
        }
    });
});