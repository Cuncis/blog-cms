import { PostStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListManagedPostsQuery } from './list-managed-posts.query.js';
import { ListPostsQuery, MAX_LIMIT, MAX_PAGE, SEARCH_MAX } from './list-posts.query.js';

function parse<T extends object>(cls: new () => T, query: Record<string, unknown>) {
    const dto = plainToInstance(cls, query);
    return { dto, errors: validateSync(dto) };
}

describe('ListPostsQuery', () => {
    it('applies the defaults when nothing is provided', () => {
        const { dto, errors } = parse(ListPostsQuery, {});

        expect(errors).toHaveLength(0);
        expect(dto).toMatchObject({ page: 1, limit: 10 });
        expect(dto.q).toBeUndefined();
    });

    it('converts query strings to numbers and trims the search text', () => {
        const { dto, errors } = parse(ListPostsQuery, { page: '3', limit: '25', q: '  redis  ' });

        expect(errors).toHaveLength(0);
        expect(dto).toMatchObject({ page: 3, limit: 25, q: 'redis' });
    });

    it('treats an empty search as "no search"', () => {
        for (const q of ['', '   ']) {
            const { dto, errors } = parse(ListPostsQuery, { q });

            expect(errors).toHaveLength(0);
            expect(dto.q).toBeNull();
        }
    });

    it('accepts the boundary values', () => {
        const { errors } = parse(ListPostsQuery, {
            page: String(MAX_PAGE),
            limit: String(MAX_LIMIT),
            q: 'a'.repeat(SEARCH_MAX),
        });

        expect(errors).toHaveLength(0);
    });

    it.each([
        { page: '0' },
        { page: '-1' },
        { page: '1.5' },
        { page: 'abc' },
        { page: '' },
        { page: String(MAX_PAGE + 1) },
        { limit: '0' },
        { limit: '-5' },
        { limit: '1.5' },
        { limit: 'many' },
        { limit: '' },
        { limit: String(MAX_LIMIT + 1) },
        { q: 'a'.repeat(SEARCH_MAX + 1) },
        { q: ['a', 'b'] },
        { q: 5 },
    ])('rejects %p', (query) => {
        expect(parse(ListPostsQuery, query).errors.length).toBeGreaterThan(0);
    });
});

describe('ListManagedPostsQuery', () => {
    it.each([PostStatus.DRAFT, PostStatus.PUBLISHED, undefined])('accepts the status %p', (status) => {
        expect(parse(ListManagedPostsQuery, { status }).errors).toHaveLength(0);
    });

    it.each(['draft', 'ARCHIVED', '', 1, ['DRAFT']])('rejects the status %p', (status) => {
        expect(parse(ListManagedPostsQuery, { status }).errors.length).toBeGreaterThan(0);
    });

    it('names the allowed statuses in the error', () => {
        const [error] = parse(ListManagedPostsQuery, { status: 'nope' }).errors;

        expect(Object.values(error?.constraints ?? {}).join(' ')).toContain('DRAFT, PUBLISHED');
    });

    it('inherits the paging and search rules', () => {
        expect(parse(ListManagedPostsQuery, { page: '0' }).errors.length).toBeGreaterThan(0);
        expect(parse(ListManagedPostsQuery, { limit: '51' }).errors.length).toBeGreaterThan(0);
        expect(parse(ListManagedPostsQuery, { page: '2', limit: '5', q: ' x ' }).dto).toMatchObject({
            page: 2,
            limit: 5,
            q: 'x',
        });
    });
});