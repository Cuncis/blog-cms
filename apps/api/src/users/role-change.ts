import { Role } from '@prisma/client';

export type LockedRow = { id: string; role: Role };

export type RoleChangePlan =
    | { kind: 'forbidden' } // the actor is not an admin (according to the database)
    | { kind: 'not-found' }
    | { kind: 'unchanged' } // the target already has this role
    | { kind: 'last-admin' } // would leave the system without an administrator
    | { kind: 'update'; previousRole: Role; revokeSessions: boolean };

const RANK: Record<Role, number> = { READER: 1, EDITOR: 2, ADMIN: 3 };

/** A demotion takes privileges away, so the user's sessions must be ended. */
export function isDemotion(from: Role, to: Role): boolean {
    return RANK[to] < RANK[from];
}

/**
 * Decides what a role change should do, given the rows locked by the transaction:
 * the actor, the target, and every admin. Pure, so every rule is easy to test.
 */
export function planRoleChange(input: {
    rows: LockedRow[];
    actorId: string;
    targetId: string;
    newRole: Role;
}): RoleChangePlan {
    const { rows, actorId, targetId, newRole } = input;

    // The actor's authority comes from the database, never from the token. This check comes
    // first, so non-admins can't use the other answers to find out which users exist.
    const actor = rows.find((row) => row.id === actorId);
    if (!actor || actor.role !== Role.ADMIN) return { kind: 'forbidden' };

    const target = rows.find((row) => row.id === targetId);
    if (!target) return { kind: 'not-found' };

    if (target.role === newRole) return { kind: 'unchanged' };

    const adminCount = rows.filter((row) => row.role === Role.ADMIN).length;
    if (target.role === Role.ADMIN && newRole !== Role.ADMIN && adminCount <= 1) {
        return { kind: 'last-admin' };
    }

    return {
        kind: 'update',
        previousRole: target.role,
        revokeSessions: isDemotion(target.role, newRole),
    };
}