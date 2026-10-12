import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';
import { publicUserSelect } from './users.types.js';

const ACTOR = 'aaaaaaaa-0000-4000-8000-000000000001';
const TARGET = 'bbbbbbbb-0000-4000-8000-000000000002';
const OTHER_ADMIN = 'cccccccc-0000-4000-8000-000000000003';

const row = (id: string, role: Role) => ({ id, role });
const publicUser = (id: string, role: Role) => ({
    id,
    email: `${id}@example.com`,
    name: 'User',
    role,
    createdAt: new Date('2026-01-01T00:00:00Z'),
});

describe('UsersService.changeRole', () => {
    let service: UsersService;
    const queryRaw = vi.fn();
    const update = vi.fn();
    const findUnique = vi.fn();
    const updateMany = vi.fn();

    beforeAll(() => {
        Logger.overrideLogger(false); // keep test output clean
    });

    beforeEach(async () => {
        [queryRaw, update, findUnique, updateMany].forEach((fn) => fn.mockReset());

        const tx = {
            $queryRaw: queryRaw,
            user: { update, findUnique },
            refreshToken: { updateMany },
        };
        const prismaMock = { $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };

        const moduleRef = await Test.createTestingModule({
            providers: [UsersService, { provide: PrismaService, useValue: prismaMock }],
        }).compile();

        service = moduleRef.get(UsersService);
    });

    it('locks the target, the actor, and every admin in one query', async () => {
        queryRaw.mockResolvedValue([row(ACTOR, Role.ADMIN), row(TARGET, Role.READER)]);
        update.mockResolvedValue(publicUser(TARGET, Role.EDITOR));

        await service.changeRole(ACTOR, TARGET, Role.EDITOR);

        const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
        expect(Array.from(strings).join('?')).toMatch(/FOR UPDATE/);
        expect(values).toEqual(expect.arrayContaining([TARGET, ACTOR]));
    });

    it('promotes without revoking any sessions', async () => {
        queryRaw.mockResolvedValue([row(ACTOR, Role.ADMIN), row(TARGET, Role.READER)]);
        update.mockResolvedValue(publicUser(TARGET, Role.ADMIN));

        const result = await service.changeRole(ACTOR, TARGET, Role.ADMIN);

        expect(update).toHaveBeenCalledWith({
            where: { id: TARGET },
            data: { role: Role.ADMIN },
            select: publicUserSelect,
        });
        expect(updateMany).not.toHaveBeenCalled();
        expect(result).toEqual(publicUser(TARGET, Role.ADMIN));
    });

    it('revokes every active refresh token of a demoted user', async () => {
        queryRaw.mockResolvedValue([row(ACTOR, Role.ADMIN), row(TARGET, Role.ADMIN)]);
        update.mockResolvedValue(publicUser(TARGET, Role.READER));

        await service.changeRole(ACTOR, TARGET, Role.READER);

        expect(updateMany).toHaveBeenCalledWith({
            where: { userId: TARGET, revokedAt: null },
            data: { revokedAt: expect.any(Date) as Date },
        });
    });

    it('does nothing and revokes nothing when the role is already set', async () => {
        queryRaw.mockResolvedValue([row(ACTOR, Role.ADMIN), row(TARGET, Role.EDITOR)]);
        findUnique.mockResolvedValue(publicUser(TARGET, Role.EDITOR));

        const result = await service.changeRole(ACTOR, TARGET, Role.EDITOR);

        expect(result).toEqual(publicUser(TARGET, Role.EDITOR));
        expect(update).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
    });

    it('refuses an actor who is no longer an admin in the database (stale token)', async () => {
        queryRaw.mockResolvedValue([
            row(ACTOR, Role.EDITOR),
            row(OTHER_ADMIN, Role.ADMIN),
            row(TARGET, Role.READER),
        ]);

        await expect(service.changeRole(ACTOR, TARGET, Role.ADMIN)).rejects.toThrow(ForbiddenException);
        expect(update).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown target', async () => {
        queryRaw.mockResolvedValue([row(ACTOR, Role.ADMIN)]);

        await expect(service.changeRole(ACTOR, TARGET, Role.EDITOR)).rejects.toThrow(NotFoundException);
        expect(update).not.toHaveBeenCalled();
    });

    it('refuses to remove the last administrator', async () => {
        queryRaw.mockResolvedValue([row(ACTOR, Role.ADMIN)]);

        await expect(service.changeRole(ACTOR, ACTOR, Role.READER)).rejects.toThrow(ConflictException);
        expect(update).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
    });

    it('turns a transaction conflict into a retryable 409', async () => {
        queryRaw.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2034', clientVersion: 'test' }),
        );

        await expect(service.changeRole(ACTOR, TARGET, Role.EDITOR)).rejects.toThrow(
            /conflicted with another update/,
        );
    });

    it('rethrows unexpected database errors untouched', async () => {
        queryRaw.mockRejectedValue(new Error('connection lost'));

        await expect(service.changeRole(ACTOR, TARGET, Role.EDITOR)).rejects.toThrow('connection lost');
    });
});