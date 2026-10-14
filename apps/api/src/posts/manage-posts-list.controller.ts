import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { NoStore } from '../common/no-store.decorator.js';
import { ListManagedPostsQuery } from './dto/list-managed-posts.query.js';
import type { Paginated } from './pagination.js';
import { MANAGE_POSTS_PATH } from './posts.constants.js';
import { PostsListService } from './posts-list.service.js';
import type { ListRow } from './posts-list.types.js';

@Controller(MANAGE_POSTS_PATH)
@Roles(Role.EDITOR, Role.ADMIN)
export class ManagePostsListController {
    constructor(private readonly lists: PostsListService) { }

    @Get()
    @NoStore() // the list includes drafts
    list(
        @Query() query: ListManagedPostsQuery,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<Paginated<ListRow>> {
        return this.lists.listManaged(actor, query);
    }
}