import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { NoStore } from '../common/no-store.decorator.js';
import { UPLOAD_LIMIT } from '../rate-limit/rate-limit.config.js';
import { CreateCoverUploadDto } from './dto/create-cover-upload.dto.js';
import { UploadCleanupService } from './upload-cleanup.service.js';
import { MANAGE_UPLOADS_PATH } from './uploads.constants.js';
import { UploadsService } from './uploads.service.js';
import type { CleanupResult, ConfirmedUpload, CoverUploadTicket } from './uploads.types.js';

@Controller(MANAGE_UPLOADS_PATH)
@Roles(Role.EDITOR, Role.ADMIN)
export class UploadsController {
    constructor(
        private readonly uploads: UploadsService,
        private readonly cleanup: UploadCleanupService,
    ) { }

    @Post('cover')
    @Throttle({ default: UPLOAD_LIMIT })
    @NoStore() // the response carries a signed policy
    createCover(
        @Body() dto: CreateCoverUploadDto,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<CoverUploadTicket> {
        return this.uploads.createCoverUpload(actor, dto);
    }

    @Post(':id/confirm')
    @HttpCode(HttpStatus.OK) // confirming creates nothing new, so 200 rather than 201
    @NoStore()
    confirm(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<ConfirmedUpload> {
        return this.uploads.confirm(actor, id);
    }

    // Runs the same job as the timer, right now. A method-level @Roles overrides the class-level one.
    @Post('cleanup')
    @Roles(Role.ADMIN)
    @HttpCode(HttpStatus.OK)
    @NoStore()
    runCleanup(): Promise<CleanupResult> {
        return this.cleanup.runOnce();
    }
}