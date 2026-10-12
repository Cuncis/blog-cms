import { Role } from '@prisma/client';
import { isDemotion, planRoleChange, type LockedRow } from './role-change.js';

const rows = (...pairs: [string, Role][]): LockedRow[] => pairs.map(([id, role]) => ({ id, role }));

describe('isDemotion', () => {
    it.each([
        [Role.ADMIN, Role.EDITOR, true],
        [Role.ADMIN, Role.READER, true],
        [Role.EDITOR, Role.READER, true],
        [Role.READER, Role.EDITOR, false],
        [Role.READER, Role.ADMIN, false],
        [Role.EDITOR, Role.ADMIN, false],
        [Role.EDITOR, Role.EDITOR, false],
    ])('%s -> %s is a demotion: %s', (from, to, expected) => {
        expect(isDemotion(from, to)).toBe(expected);
    });
});

describe('planRoleChange', () => {
    it('forbids an actor who is missing from the locked rows', () => {
        const plan = planRoleChange({
            rows: rows(['target', Role.READER]),
            actorId: 'actor',
            targetId: 'target',
            newRole: Role.EDITOR,
        });

        expect(plan).toEqual({ kind: 'forbidden' });
    });

    it('forbids an actor who is no longer an admin, even if their token still says so', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.EDITOR], ['boss', Role.ADMIN], ['target', Role.READER]),
            actorId: 'actor',
            targetId: 'target',
            newRole: Role.ADMIN,
        });

        expect(plan).toEqual({ kind: 'forbidden' });
    });

    it('answers "forbidden" before "not found", so non-admins cannot probe which users exist', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.READER], ['boss', Role.ADMIN]),
            actorId: 'actor',
            targetId: 'ghost',
            newRole: Role.EDITOR,
        });

        expect(plan).toEqual({ kind: 'forbidden' });
    });

    it('reports a missing target', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.ADMIN]),
            actorId: 'actor',
            targetId: 'ghost',
            newRole: Role.EDITOR,
        });

        expect(plan).toEqual({ kind: 'not-found' });
    });

    it('reports an unchanged role', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.ADMIN], ['target', Role.EDITOR]),
            actorId: 'actor',
            targetId: 'target',
            newRole: Role.EDITOR,
        });

        expect(plan).toEqual({ kind: 'unchanged' });
    });

    it('refuses to demote the only admin, even when they demote themselves', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.ADMIN], ['other', Role.READER]),
            actorId: 'actor',
            targetId: 'actor',
            newRole: Role.READER,
        });

        expect(plan).toEqual({ kind: 'last-admin' });
    });

    it('allows demoting an admin while another admin remains, and revokes their sessions', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.ADMIN], ['target', Role.ADMIN]),
            actorId: 'actor',
            targetId: 'target',
            newRole: Role.EDITOR,
        });

        expect(plan).toEqual({ kind: 'update', previousRole: Role.ADMIN, revokeSessions: true });
    });

    it('allows an admin to demote themselves when another admin remains', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.ADMIN], ['other', Role.ADMIN]),
            actorId: 'actor',
            targetId: 'actor',
            newRole: Role.READER,
        });

        expect(plan).toEqual({ kind: 'update', previousRole: Role.ADMIN, revokeSessions: true });
    });

    it('promotes without revoking sessions', () => {
        expect(
            planRoleChange({
                rows: rows(['actor', Role.ADMIN], ['target', Role.READER]),
                actorId: 'actor',
                targetId: 'target',
                newRole: Role.ADMIN,
            }),
        ).toEqual({ kind: 'update', previousRole: Role.READER, revokeSessions: false });

        expect(
            planRoleChange({
                rows: rows(['actor', Role.ADMIN], ['target', Role.READER]),
                actorId: 'actor',
                targetId: 'target',
                newRole: Role.EDITOR,
            }),
        ).toEqual({ kind: 'update', previousRole: Role.READER, revokeSessions: false });
    });

    it('revokes sessions when an editor is demoted to reader', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.ADMIN], ['target', Role.EDITOR]),
            actorId: 'actor',
            targetId: 'target',
            newRole: Role.READER,
        });

        expect(plan).toEqual({ kind: 'update', previousRole: Role.EDITOR, revokeSessions: true });
    });

    it('does not care how many admins exist when the target is not an admin', () => {
        const plan = planRoleChange({
            rows: rows(['actor', Role.ADMIN], ['target', Role.READER]),
            actorId: 'actor',
            targetId: 'target',
            newRole: Role.EDITOR,
        });

        expect(plan.kind).toBe('update');
    });
});