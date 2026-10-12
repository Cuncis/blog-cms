import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { FORBIDDEN_MESSAGE } from './auth.constants.js';
import type { AuthenticatedUser } from './auth.types.js';
import { Roles } from './decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

// Real decorators and a real Reflector, so we test the actual @Roles wiring
@Roles(Role.ADMIN)
class AdminController {
    adminOnly(): void { }

    @Roles(Role.EDITOR, Role.ADMIN)
    editorsToo(): void { }
}

class OpenController {
    anyone(): void { }
}

function contextFor(cls: new () => object, handler: () => void, user?: AuthenticatedUser) {
    return {
        getHandler: () => handler,
        getClass: () => cls,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
}

const user = (role: Role): AuthenticatedUser => ({ id: 'user-1', role });

describe('RolesGuard', () => {
    const guard = new RolesGuard(new Reflector());

    it('lets any request through on routes without @Roles (even with no user at all)', () => {
        expect(guard.canActivate(contextFor(OpenController, OpenController.prototype.anyone))).toBe(true);
    });

    it('lets a user with an allowed role through', () => {
        const context = contextFor(AdminController, AdminController.prototype.adminOnly, user(Role.ADMIN));

        expect(guard.canActivate(context)).toBe(true);
    });

    it.each([Role.EDITOR, Role.READER])('refuses the role %s on an admin-only route with 403', (role) => {
        const context = contextFor(AdminController, AdminController.prototype.adminOnly, user(role));

        expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
        expect(() => guard.canActivate(context)).toThrow(FORBIDDEN_MESSAGE);
    });

    it('lets a method-level @Roles override the class-level one', () => {
        const editor = contextFor(AdminController, AdminController.prototype.editorsToo, user(Role.EDITOR));
        const reader = contextFor(AdminController, AdminController.prototype.editorsToo, user(Role.READER));

        expect(guard.canActivate(editor)).toBe(true);
        expect(() => guard.canActivate(reader)).toThrow(ForbiddenException);
    });

    it('fails closed with 401 when a @Roles route has no authenticated user', () => {
        const context = contextFor(AdminController, AdminController.prototype.adminOnly);

        expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });
});