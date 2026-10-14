import { Module } from '@nestjs/common';
import { ManagePostsController } from './manage-posts.controller.js';
import { ManagePostsListController } from './manage-posts-list.controller.js';
import { PostsListService } from './posts-list.service.js';
import { PostsService } from './posts.service.js';
import { PublicPostsController } from './public-posts.controller.js';
import { PublicPostsListController } from './public-posts-list.controller.js';
import { PublicPostsReader } from './public-posts.reader.js';

@Module({
    controllers: [
        PublicPostsController,
        PublicPostsListController,
        ManagePostsController,
        ManagePostsListController,
    ],
    providers: [PostsService, PostsListService, PublicPostsReader],
})
export class PostsModule { }