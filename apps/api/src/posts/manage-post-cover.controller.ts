import { Body, Controller, Delete, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { NoStore } from '../common/no-store.decorator.js';
import { AttachCoverDto } from './dto/attach-cover.dto.js';
import { MANAGE_POSTS_PATH } from './posts.constants.js';
import { PostCoversService } from './post-covers.service.js';
import type { ManagePost } from './posts.types.js';

@Controller(MANAGE_POSTS_PATH)
@Roles(Role.EDITOR, Role.ADMIN)
export class ManagePostCoverController {
    constructor(private readonly covers: PostCoversService) { }

    @Put(':id/cover')
    @NoStore()
    attach(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: AttachCoverDto,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<ManagePost> {
        return this.covers.attach(actor, id, dto.uploadId);
    }

    @Delete(':id/cover')
    @NoStore()
    detach(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<ManagePost> {
        return this.covers.detach(actor, id);
    }
}