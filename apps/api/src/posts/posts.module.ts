import { Module } from '@nestjs/common';
import { ManagePostsController } from './manage-posts.controller.js';
import { PostsService } from './posts.service.js';
import { PublicPostsController } from './public-posts.controller.js';

@Module({
    controllers: [PublicPostsController, ManagePostsController],
    providers: [PostsService],
})
export class PostsModule { }