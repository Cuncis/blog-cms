import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { PostStatus } from '@prisma/client';
import { AUTH_REQUIRED_MESSAGE } from '../auth/auth.constants.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CacheService } from '../cache/cache.service.js';
import {
    isForeignKeyViolation,
    isRecordNotFound,
    isUniqueViolation,
} from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreatePostDto } from './dto/create-post.dto.js';
import type { UpdatePostDto } from './dto/update-post.dto.js';
import { canManagePost, publicationFields } from './post-policy.js';
import { PUBLIC_POSTS_SCOPE } from './posts-cache.js';
import {
    managePostSelect,
    publicPostSelect,
    type ManagePost,
    type PublicPost,
} from './posts.types.js';
import { normalizeSlug, pickSlug, slugCandidates, slugify } from './slug.util.js';

const POST_NOT_FOUND = 'Post not found.';

// Each retry needs a collision, so this only matters when many identical titles
// are created in the same instant
const MAX_CREATE_ATTEMPTS = 8;

@Injectable()
export class PostsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CacheService,
    ) { }

    async create(actor: AuthenticatedUser, dto: CreatePostDto): Promise<ManagePost> {
        const base = slugify(dto.title);

        // No cache invalidation here: a new post is a draft, and the public can't see drafts
        for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
            const slug = await this.chooseSlug(base);

            try {
                return await this.prisma.post.create({
                    data: {
                        slug,
                        title: dto.title,
                        excerpt: dto.excerpt,
                        content: dto.content,
                        authorId: actor.id, // always the logged-in user, never taken from the body
                    },
                    select: managePostSelect,
                });
            } catch (error) {
                // Someone took this slug between our lookup and our insert: look again and retry.
                // The unique index decides, so two requests can never end up with the same slug.
                if (isUniqueViolation(error)) continue;

                // A valid token for an account that no longer exists
                if (isForeignKeyViolation(error)) throw new UnauthorizedException(AUTH_REQUIRED_MESSAGE);

                throw error;
            }
        }

        throw new ConflictException('Could not reserve a URL for this post. Please try again.');
    }

    /** A post the actor is allowed to manage, drafts included. */
    async getManaged(actor: AuthenticatedUser, id: string): Promise<ManagePost> {
        const post = await this.prisma.post.findUnique({ where: { id }, select: managePostSelect });

        // One answer for "does not exist" and "not yours", so ids can't be probed for other people's drafts
        if (!post || !canManagePost(actor, post)) throw new NotFoundException(POST_NOT_FOUND);

        return post;
    }

    async update(actor: AuthenticatedUser, id: string, dto: UpdatePostDto): Promise<ManagePost> {
        // slug, status, and publishedAt are deliberately not updatable here
        const data = { title: dto.title, excerpt: dto.excerpt, content: dto.content };

        if (Object.values(data).every((value) => value === undefined)) {
            throw new BadRequestException('Provide at least one field to update.');
        }

        // The author never changes, so checking ownership first and updating second is safe
        await this.getManaged(actor, id);

        let updated: ManagePost;
        try {
            updated = await this.prisma.post.update({ where: { id }, data, select: managePostSelect });
        } catch (error) {
            if (isRecordNotFound(error)) throw new NotFoundException(POST_NOT_FOUND); // deleted meanwhile
            throw error;
        }

        await this.invalidatePublicCache();
        return updated;
    }

    publish(actor: AuthenticatedUser, id: string): Promise<ManagePost> {
        return this.transition(actor, id, PostStatus.PUBLISHED);
    }

    unpublish(actor: AuthenticatedUser, id: string): Promise<ManagePost> {
        return this.transition(actor, id, PostStatus.DRAFT);
    }

    async remove(actor: AuthenticatedUser, id: string): Promise<void> {
        await this.getManaged(actor, id);

        try {
            await this.prisma.post.delete({ where: { id } });
        } catch (error) {
            if (isRecordNotFound(error)) throw new NotFoundException(POST_NOT_FOUND);
            throw error;
        }

        await this.invalidatePublicCache();
    }

    /** Public read. The status filter is what keeps drafts from ever leaking. */
    async getPublished(rawSlug: string): Promise<PublicPost> {
        const slug = normalizeSlug(rawSlug);

        // Can't possibly exist: skip the database
        if (slug === null) throw new NotFoundException(POST_NOT_FOUND);

        const post = await this.prisma.post.findFirst({
            where: { slug, status: PostStatus.PUBLISHED },
            select: publicPostSelect,
        });

        // A draft and a missing post look exactly the same
        if (!post) throw new NotFoundException(POST_NOT_FOUND);

        return post;
    }

    private async transition(
        actor: AuthenticatedUser,
        id: string,
        target: PostStatus,
    ): Promise<ManagePost> {
        const current = await this.getManaged(actor, id);

        // Already there: nothing to write and nothing for the public to see change
        if (current.status === target) return current;

        // Conditional update: of two concurrent requests, only one changes the row
        await this.prisma.post.updateMany({
            where: { id, status: current.status },
            data: publicationFields(target, new Date()),
        });
        await this.invalidatePublicCache();

        const fresh = await this.prisma.post.findUnique({ where: { id }, select: managePostSelect });
        if (!fresh) throw new NotFoundException(POST_NOT_FOUND); // deleted meanwhile

        return fresh;
    }

    /**
     * Anything that can change what the public sees must call this AFTER its database write.
     * It never throws, so a Redis outage can't fail a write that already succeeded.
     */
    private async invalidatePublicCache(): Promise<void> {
        await this.cache.invalidate(PUBLIC_POSTS_SCOPE);
    }

    /** One IN query on the unique index finds which candidate slugs are taken. */
    private async chooseSlug(base: string): Promise<string> {
        const existing = await this.prisma.post.findMany({
            where: { slug: { in: slugCandidates(base) } },
            select: { slug: true },
        });

        return pickSlug(base, new Set(existing.map((post) => post.slug)));
    }
}