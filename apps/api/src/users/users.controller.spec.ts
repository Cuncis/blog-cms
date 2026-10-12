import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { UsersController } from './users.controller.js';
import type { UsersService } from './users.service.js';

describe('UsersController', () => {
    it('restricts role changes to admins (this fails if someone removes the decorator)', () => {
        const roles = new Reflector().get<Role[]>(ROLES_KEY, UsersController.prototype.changeRole);

        expect(roles).toEqual([Role.ADMIN]);
    });

    it('passes the actor, the target, and the new role to the service', async () => {
        const changeRole = vi.fn().mockResolvedValue({ id: 'target' });
        const controller = new UsersController({ changeRole } as unknown as UsersService);

        const result = await controller.changeRole(
            'target',
            { role: Role.EDITOR },
            { id: 'actor', role: Role.ADMIN },
        );

        expect(changeRole).toHaveBeenCalledWith('actor', 'target', Role.EDITOR);
        expect(result).toEqual({ id: 'target' });
    });
});