import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route (or a whole controller) to the listed roles.
 * A method-level @Roles overrides a class-level one. At least one role is required,
 * so an empty list can never silently mean "everyone".
 */
export const Roles = (...roles: [Role, ...Role[]]) => SetMetadata(ROLES_KEY, roles);