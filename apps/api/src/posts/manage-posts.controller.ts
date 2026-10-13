import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { NoStore } from '../common/no-store.decorator.js';
import { CreatePostDto } from './dto/create-post.dto.js';
import { UpdatePostDto } from './dto/update-post.dto.js';
import { MANAGE_POSTS_PATH } from './posts.constants.js';
import { PostsService } from './posts.service.js';
import type { ManagePost } from './posts.types.js';

// The guard gates by role. The service decides which posts each user may touch.
@Controller(MANAGE_POSTS_PATH)
@Roles(Role.EDITOR, Role.ADMIN)
export class ManagePostsController {
    constructor(private readonly posts: PostsService) { }

    @Post()
    @NoStore()
    create(@Body() dto: CreatePostDto, @CurrentUser() actor: AuthenticatedUser): Promise<ManagePost> {
        return this.posts.create(actor, dto);
    }

    @Get(':id')
    @NoStore()
    findOne(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<ManagePost> {
        return this.posts.getManaged(actor, id);
    }

    @Patch(':id')
    @NoStore()
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdatePostDto,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<ManagePost> {
        return this.posts.update(actor, id, dto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<void> {
        await this.posts.remove(actor, id);
    }

    @Post(':id/publish')
    @HttpCode(HttpStatus.OK) // publishing creates nothing, so 200 rather than 201
    @NoStore()
    publish(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<ManagePost> {
        return this.posts.publish(actor, id);
    }

    @Post(':id/unpublish')
    @HttpCode(HttpStatus.OK)
    @NoStore()
    unpublish(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<ManagePost> {
        return this.posts.unpublish(actor, id);
    }
}