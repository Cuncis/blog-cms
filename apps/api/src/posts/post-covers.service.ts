import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UploadStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CacheService } from '../cache/cache.service.js';
import {
    isForeignKeyViolation,
    isRecordNotFound,
    isUniqueViolation,
} from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UPLOAD_NOT_FOUND } from '../uploads/uploads.constants.js';
import { PUBLIC_POSTS_SCOPE } from './posts-cache.js';
import { PostsService } from './posts.service.js';
import { managePostSelect, type ManagePost } from './posts.types.js';

const POST_NOT_FOUND = 'Post not found.';
const UPLOAD_NOT_CONFIRMED = 'This upload has not been confirmed yet.';
const IMAGE_IN_USE = 'This image is already the cover of another post.';

@Injectable()
export class PostCoversService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly posts: PostsService,
        private readonly cache: CacheService,
    ) { }

    async attach(actor: AuthenticatedUser, postId: string, uploadId: string): Promise<ManagePost> {
        // 404 for a missing post and for someone else's post alike
        await this.posts.getManaged(actor, postId);

        // Only your own uploads: another user's upload looks exactly like a missing one
        const upload = await this.prisma.upload.findFirst({
            where: { id: uploadId, userId: actor.id },
            select: { status: true },
        });
        if (!upload) throw new NotFoundException(UPLOAD_NOT_FOUND);
        if (upload.status !== UploadStatus.CONFIRMED) throw new ConflictException(UPLOAD_NOT_CONFIRMED);

        return this.setCover(postId, uploadId);
    }

    async detach(actor: AuthenticatedUser, postId: string): Promise<ManagePost> {
        const current = await this.posts.getManaged(actor, postId);

        // Nothing to remove: nothing to write, and nothing for the public to see change
        if (current.coverImageId === null) return current;

        return this.setCover(postId, null);
    }

    private async setCover(postId: string, uploadId: string | null): Promise<ManagePost> {
        let post: ManagePost;

        try {
            post = await this.prisma.post.update({
                where: { id: postId },
                data: { coverImageId: uploadId },
                select: managePostSelect,
            });
        } catch (error) {
            if (isUniqueViolation(error)) throw new ConflictException(IMAGE_IN_USE);
            if (isForeignKeyViolation(error)) throw new NotFoundException(UPLOAD_NOT_FOUND); // cleaned up meanwhile
            if (isRecordNotFound(error)) throw new NotFoundException(POST_NOT_FOUND); // deleted meanwhile
            throw error;
        }

        // After the write, like every other change the public can see
        await this.cache.invalidate(PUBLIC_POSTS_SCOPE);

        return post;
    }
}