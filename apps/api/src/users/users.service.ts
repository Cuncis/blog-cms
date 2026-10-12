import {
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { Role, User } from '@prisma/client';
import { FORBIDDEN_MESSAGE } from '../auth/auth.constants.js';
import { isTransactionConflict } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { planRoleChange, type LockedRow } from './role-change.js';
import { publicUserSelect, type PublicUser } from './users.types.js';

type NewUser = {
    email: string;
    name: string;
    passwordHash: string;
    // No role here on purpose: everyone registers as READER (the database default)
};

type RoleChangeOutcome = { user: PublicUser; previousRole: Role | null };

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(private readonly prisma: PrismaService) { }

    create(data: NewUser): Promise<PublicUser> {
        return this.prisma.user.create({ data, select: publicUserSelect });
    }

    /**
     * Returns the FULL row including passwordHash. Internal use only (login):
     * never send this object to a client.
     */
    findByEmail(email: string): Promise<User | null> {
        return this.prisma.user.findUnique({ where: { email } });
    }

    findPublicById(id: string): Promise<PublicUser | null> {
        return this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
    }

    /**
     * Changes a user's role. The actor's authority is re-checked in the database, not taken
     * from the access token, and the "never remove the last admin" rule is enforced under a lock.
     */
    async changeRole(actorId: string, targetId: string, newRole: Role): Promise<PublicUser> {
        let outcome: RoleChangeOutcome;

        try {
            outcome = await this.prisma.$transaction(async (tx): Promise<RoleChangeOutcome> => {
                // One locking read: the target, the actor, and every admin, in a fixed order.
                // A concurrent role change waits here until we commit, then sees our result,
                // so two admins can never demote each other at the same time.
                const rows = await tx.$queryRaw<LockedRow[]>`
          SELECT id, role FROM users
          WHERE role = 'ADMIN' OR id IN (${targetId}, ${actorId})
          ORDER BY id
          FOR UPDATE`;

                const plan = planRoleChange({ rows, actorId, targetId, newRole });

                switch (plan.kind) {
                    case 'forbidden':
                        throw new ForbiddenException(FORBIDDEN_MESSAGE);

                    case 'not-found':
                        throw new NotFoundException('User not found.');

                    case 'last-admin':
                        throw new ConflictException('Cannot remove the last administrator.');

                    case 'unchanged': {
                        const current = await tx.user.findUnique({
                            where: { id: targetId },
                            select: publicUserSelect,
                        });
                        if (!current) throw new NotFoundException('User not found.');

                        return { user: current, previousRole: null };
                    }

                    case 'update': {
                        const user = await tx.user.update({
                            where: { id: targetId },
                            data: { role: newRole },
                            select: publicUserSelect,
                        });

                        if (plan.revokeSessions) {
                            // They can no longer mint new tokens with the role they just lost
                            await tx.refreshToken.updateMany({
                                where: { userId: targetId, revokedAt: null },
                                data: { revokedAt: new Date() },
                            });
                        }

                        return { user, previousRole: plan.previousRole };
                    }

                    default: {
                        const unreachable: never = plan; // a new plan kind must be handled above
                        return unreachable;
                    }
                }
            });
        } catch (error) {
            if (isTransactionConflict(error)) {
                throw new ConflictException('The change conflicted with another update. Please try again.');
            }
            throw error;
        }

        if (outcome.previousRole !== null) {
            this.logger.log(`Role changed: ${targetId} ${outcome.previousRole} -> ${newRole} by ${actorId}`);
        }

        return outcome.user;
    }
}