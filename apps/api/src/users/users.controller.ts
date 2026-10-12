import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { UsersService } from './users.service.js';
import type { PublicUser } from './users.types.js';

@Controller('users')
export class UsersController {
    constructor(private readonly users: UsersService) { }

    // The guard rejects non-admins using the token. The service then re-checks the database.
    @Patch(':id/role')
    @Roles(Role.ADMIN)
    changeRole(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateRoleDto,
        @CurrentUser() actor: AuthenticatedUser,
    ): Promise<PublicUser> {
        return this.users.changeRole(actor.id, id, dto.role);
    }
}