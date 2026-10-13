import {
    BadRequestException,
    ConflictException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostStatus, Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PostsService } from './posts.service.js';
import { managePostSelect, publicPostSelect } from './posts.types.js';
import { slugCandidates } from './slug.util.js';

const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });

const POST_ID = '11111111-1111-4111-8111-111111111111';
const admin: AuthenticatedUser = { id: 'admin-1', role: Role.ADMIN };
const author: AuthenticatedUser = { id: 'editor-1', role: Role.EDITOR };
const otherEditor: AuthenticatedUser = { id: 'editor-2', role: Role.EDITOR };

const storedPost = (overrides: Record<string, unknown> = {}) => ({
    id: POST_ID,
    slug: 'hello-world',
    title: 'Hello, World!',
    excerpt: null,
    content: 'Body',
    status: PostStatus.DRAFT,
    publishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    author: { id: author.id, name: 'Ann' },
    ...overrides,
});

describe('PostsService', () => {
    let service: PostsService;
    const findMany = vi.fn();
    const findUnique = vi.fn();
    const findFirst = vi.fn();
    const create = vi.fn();
    const update = vi.fn();
    const updateMany = vi.fn();
    const del = vi.fn();

    beforeEach(async () => {
        [findMany, findUnique, findFirst, create, update, updateMany, del].forEach((fn) => fn.mockReset());
        findMany.mockResolvedValue([]);

        const prismaMock = {
            post: { findMany, findUnique, findFirst, create, update, updateMany, delete: del },
        };

        const moduleRef = await Test.createTestingModule({
            providers: [PostsService, { provide: PrismaService, useValue: prismaMock }],
        }).compile();

        service = moduleRef.get(PostsService);
    });

    describe('create', () => {
        const dto = { title: 'Hello, World!', content: 'Body' };

        it('creates the post for the logged-in user, with a slug made from the title', async () => {
            create.mockResolvedValue(storedPost());

            await service.create(author, dto);

            expect(create).toHaveBeenCalledWith({
                data: {
                    slug: 'hello-world',
                    title: 'Hello, World!',
                    excerpt: undefined,
                    content: 'Body',
                    authorId: 'editor-1',
                },
                select: managePostSelect,
            });
        });

        it('never sets status or publishedAt: new posts are drafts by database default', async () => {
            create.mockResolvedValue(storedPost());

            await service.create(author, dto);

            const { data } = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
            expect(data).not.toHaveProperty('status');
            expect(data).not.toHaveProperty('publishedAt');
        });

        it('finds taken slugs with a single IN query', async () => {
            create.mockResolvedValue(storedPost());

            await service.create(author, dto);

            expect(findMany).toHaveBeenCalledTimes(1);
            expect(findMany).toHaveBeenCalledWith({
                where: { slug: { in: slugCandidates('hello-world') } },
                select: { slug: true },
            });
        });

        it('adds the next free number when the slug is taken', async () => {
            findMany.mockResolvedValue([{ slug: 'hello-world' }, { slug: 'hello-world-2' }]);
            create.mockResolvedValue(storedPost({ slug: 'hello-world-3' }));

            await service.create(author, dto);

            expect(create.mock.calls[0]?.[0]).toMatchObject({ data: { slug: 'hello-world-3' } });
        });

        it('uses "post" for titles without Latin letters', async () => {
            create.mockResolvedValue(storedPost({ slug: 'post' }));

            await service.create(author, { title: '你好', content: 'Body' });

            expect(create.mock.calls[0]?.[0]).toMatchObject({ data: { slug: 'post' } });
        });

        it('looks again and retries when another request takes the slug first', async () => {
            findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ slug: 'hello-world' }]);
            create
                .mockRejectedValueOnce(prismaError('P2002'))
                .mockResolvedValueOnce(storedPost({ slug: 'hello-world-2' }));

            await service.create(author, dto);

            expect(create).toHaveBeenCalledTimes(2);
            expect(create.mock.calls[1]?.[0]).toMatchObject({ data: { slug: 'hello-world-2' } });
        });

        it('gives up with a retryable 409 after repeated collisions', async () => {
            create.mockRejectedValue(prismaError('P2002'));

            await expect(service.create(author, dto)).rejects.toThrow(ConflictException);
            expect(create).toHaveBeenCalledTimes(8);
        });

        it('answers 401 when the author account no longer exists', async () => {
            create.mockRejectedValue(prismaError('P2003'));

            await expect(service.create(author, dto)).rejects.toThrow(UnauthorizedException);
            expect(create).toHaveBeenCalledTimes(1);
        });

        it('rethrows unexpected database errors untouched', async () => {
            create.mockRejectedValue(new Error('connection lost'));

            await expect(service.create(author, dto)).rejects.toThrow('connection lost');
        });
    });

    describe('getManaged', () => {
        it('returns the actor\'s own post, drafts included', async () => {
            findUnique.mockResolvedValue(storedPost());

            await expect(service.getManaged(author, POST_ID)).resolves.toMatchObject({ id: POST_ID });
            expect(findUnique).toHaveBeenCalledWith({ where: { id: POST_ID }, select: managePostSelect });
        });

        it('lets an admin read anyone\'s post', async () => {
            findUnique.mockResolvedValue(storedPost());

            await expect(service.getManaged(admin, POST_ID)).resolves.toMatchObject({ id: POST_ID });
        });

        it('answers 404 for someone else\'s post', async () => {
            findUnique.mockResolvedValue(storedPost());

            await expect(service.getManaged(otherEditor, POST_ID)).rejects.toThrow(NotFoundException);
        });

        it('answers 404 for a post that does not exist', async () => {
            findUnique.mockResolvedValue(null);

            await expect(service.getManaged(author, POST_ID)).rejects.toThrow(NotFoundException);
        });

        it('gives the same answer for "missing" and "not yours", so ids cannot be probed', async () => {
            findUnique.mockResolvedValueOnce(null);
            const missing = await service.getManaged(author, POST_ID).catch((e: NotFoundException) => e);

            findUnique.mockResolvedValueOnce(storedPost());
            const notYours = await service.getManaged(otherEditor, POST_ID).catch((e: NotFoundException) => e);

            expect((missing as NotFoundException).getResponse()).toEqual(
                (notYours as NotFoundException).getResponse(),
            );
        });
    });

    describe('update', () => {
        beforeEach(() => {
            findUnique.mockResolvedValue(storedPost());
            update.mockResolvedValue(storedPost({ title: 'New' }));
        });

        it('writes only the fields that were provided', async () => {
            await service.update(author, POST_ID, { title: 'New' });

            const args = update.mock.calls[0]?.[0] as { where: unknown; data: unknown; select: unknown };
            expect(args.where).toEqual({ id: POST_ID });
            expect(args.data).toEqual({ title: 'New' }); // undefined fields are absent
            expect(args.select).toEqual(managePostSelect);
        });

        it('can never change the slug, the status, or publishedAt', async () => {
            await service.update(author, POST_ID, { title: 'New', content: 'Body', excerpt: 'Sum' });

            const { data } = update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
            expect(data).not.toHaveProperty('slug');
            expect(data).not.toHaveProperty('status');
            expect(data).not.toHaveProperty('publishedAt');
        });

        it('clears the excerpt with null', async () => {
            await service.update(author, POST_ID, { excerpt: null });

            const { data } = update.mock.calls[0]?.[0] as { data: { excerpt: unknown } };
            expect(data.excerpt).toBeNull();
        });

        it('rejects an update with nothing to change, before touching the database', async () => {
            await expect(service.update(author, POST_ID, {})).rejects.toThrow(BadRequestException);

            expect(findUnique).not.toHaveBeenCalled();
            expect(update).not.toHaveBeenCalled();
        });

        it('lets an admin edit anyone\'s post', async () => {
            await expect(service.update(admin, POST_ID, { title: 'New' })).resolves.toBeDefined();
        });

        it('answers 404 for someone else\'s post and writes nothing', async () => {
            await expect(service.update(otherEditor, POST_ID, { title: 'New' })).rejects.toThrow(
                NotFoundException,
            );
            expect(update).not.toHaveBeenCalled();
        });

        it('answers 404 when the post is deleted between the check and the write', async () => {
            update.mockRejectedValue(prismaError('P2025'));

            await expect(service.update(author, POST_ID, { title: 'New' })).rejects.toThrow(NotFoundException);
        });
    });

    describe('publish and unpublish', () => {
        const draft = () => storedPost();
        const published = () =>
            storedPost({ status: PostStatus.PUBLISHED, publishedAt: new Date('2026-02-01T00:00:00Z') });

        it('publishes a draft with a conditional update that sets publishedAt', async () => {
            findUnique.mockResolvedValueOnce(draft()).mockResolvedValueOnce(published());

            const result = await service.publish(author, POST_ID);

            expect(updateMany).toHaveBeenCalledWith({
                where: { id: POST_ID, status: PostStatus.DRAFT },
                data: { status: PostStatus.PUBLISHED, publishedAt: expect.any(Date) as Date },
            });
            expect(result.status).toBe(PostStatus.PUBLISHED);
        });

        it('does nothing when the post is already published (publishedAt keeps its value)', async () => {
            findUnique.mockResolvedValue(published());

            const result = await service.publish(author, POST_ID);

            expect(updateMany).not.toHaveBeenCalled();
            expect(result.publishedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
        });

        it('unpublishes with a conditional update that clears publishedAt', async () => {
            findUnique.mockResolvedValueOnce(published()).mockResolvedValueOnce(draft());

            await service.unpublish(author, POST_ID);

            expect(updateMany).toHaveBeenCalledWith({
                where: { id: POST_ID, status: PostStatus.PUBLISHED },
                data: { status: PostStatus.DRAFT, publishedAt: null },
            });
        });

        it('does nothing when the post is already a draft', async () => {
            findUnique.mockResolvedValue(draft());

            await service.unpublish(author, POST_ID);

            expect(updateMany).not.toHaveBeenCalled();
        });

        it('answers 404 for someone else\'s post and writes nothing', async () => {
            findUnique.mockResolvedValue(draft());

            await expect(service.publish(otherEditor, POST_ID)).rejects.toThrow(NotFoundException);
            expect(updateMany).not.toHaveBeenCalled();
        });

        it('lets an admin publish anyone\'s post', async () => {
            findUnique.mockResolvedValueOnce(draft()).mockResolvedValueOnce(published());

            await expect(service.publish(admin, POST_ID)).resolves.toBeDefined();
        });

        it('answers 404 when the post is deleted during the change', async () => {
            findUnique.mockResolvedValueOnce(draft()).mockResolvedValueOnce(null);

            await expect(service.publish(author, POST_ID)).rejects.toThrow(NotFoundException);
        });
    });

    describe('remove', () => {
        it('deletes the actor\'s own post', async () => {
            findUnique.mockResolvedValue(storedPost());
            del.mockResolvedValue(storedPost());

            await expect(service.remove(author, POST_ID)).resolves.toBeUndefined();
            expect(del).toHaveBeenCalledWith({ where: { id: POST_ID } });
        });

        it('lets an admin delete anyone\'s post', async () => {
            findUnique.mockResolvedValue(storedPost());
            del.mockResolvedValue(storedPost());

            await expect(service.remove(admin, POST_ID)).resolves.toBeUndefined();
        });

        it('answers 404 for someone else\'s post and deletes nothing', async () => {
            findUnique.mockResolvedValue(storedPost());

            await expect(service.remove(otherEditor, POST_ID)).rejects.toThrow(NotFoundException);
            expect(del).not.toHaveBeenCalled();
        });

        it('answers 404 when the post is already gone', async () => {
            findUnique.mockResolvedValue(storedPost());
            del.mockRejectedValue(prismaError('P2025'));

            await expect(service.remove(author, POST_ID)).rejects.toThrow(NotFoundException);
        });
    });

    describe('getPublished', () => {
        it('only ever looks for published posts, using the public selection', async () => {
            findFirst.mockResolvedValue({ slug: 'hello' });

            await service.getPublished('hello');

            expect(findFirst).toHaveBeenCalledWith({
                where: { slug: 'hello', status: PostStatus.PUBLISHED },
                select: publicPostSelect,
            });
        });

        it('looks slugs up in lowercase', async () => {
            findFirst.mockResolvedValue({ slug: 'hello' });

            await service.getPublished('HeLLo');

            expect(findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { slug: 'hello' } });
        });

        it('answers 404 when nothing is published under that slug (a draft looks like a missing post)', async () => {
            findFirst.mockResolvedValue(null);

            await expect(service.getPublished('a-draft')).rejects.toThrow(NotFoundException);
        });

        it.each(['', 'has space', '../etc/passwd', '-leading', 'trailing-', 'double--hyphen', 'a'.repeat(201)])(
            'answers 404 for the impossible slug %p without querying the database',
            async (slug) => {
                await expect(service.getPublished(slug)).rejects.toThrow(NotFoundException);
                expect(findFirst).not.toHaveBeenCalled();
            },
        );

        it('never exposes ids, status, or email in the selection', () => {
            expect(Object.keys(publicPostSelect).sort()).toEqual([
                'author',
                'content',
                'excerpt',
                'publishedAt',
                'slug',
                'title',
                'updatedAt',
            ]);
            expect(publicPostSelect.author).toEqual({ select: { name: true } });
        });
    });
});