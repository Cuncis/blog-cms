import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PostStatus, Prisma, Role } from '@prisma/client';
import { FORBIDDEN_MESSAGE } from '../auth/auth.constants.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListManagedPostsQuery } from './dto/list-managed-posts.query.js';
import type { ListPostsQuery } from './dto/list-posts.query.js';
import { paginate, type Paginated } from './pagination.js';
import {
    listSelect,
    toPublicItem,
    type ListRow,
    type PublicPostListItem,
} from './posts-list.types.js';
import { buildBooleanQuery, parseSearchTerms } from './search-query.js';

const SEARCH_NEEDS_A_WORD =
    'Search terms must include a word of at least 3 letters or numbers (very common words such as "the" are ignored).';

type Filter = { status?: PostStatus; authorId?: string };
type Order = 'published' | 'created';

// Matches the [status, publishedAt] and [authorId, createdAt] indexes. InnoDB appends the primary key
// to every secondary index, so the `id` tiebreaker costs nothing.
const ORDER_BY: Record<Order, Prisma.PostOrderByWithRelationInput[]> = {
    published: [{ publishedAt: 'desc' }, { id: 'desc' }],
    created: [{ createdAt: 'desc' }, { id: 'desc' }],
};

const TIEBREAK: Record<Order, Prisma.Sql> = {
    published: Prisma.sql`publishedAt DESC, id DESC`,
    created: Prisma.sql`createdAt DESC, id DESC`,
};

@Injectable()
export class PostsListService {
    constructor(private readonly prisma: PrismaService) { }

    async listPublished(query: ListPostsQuery): Promise<Paginated<PublicPostListItem>> {
        const { rows, total } = await this.fetchPage({
            filter: { status: PostStatus.PUBLISHED }, // the status filter is what keeps drafts out
            order: 'published',
            terms: this.termsFor(query.q),
            page: query.page,
            limit: query.limit,
        });

        return paginate(rows.map(toPublicItem), total, query.page, query.limit);
    }

    async listManaged(
        actor: AuthenticatedUser,
        query: ListManagedPostsQuery,
    ): Promise<Paginated<ListRow>> {
        // The same rule as canManagePost: admins see every post, editors only their own, nobody else anything
        if (actor.role !== Role.ADMIN && actor.role !== Role.EDITOR) {
            throw new ForbiddenException(FORBIDDEN_MESSAGE);
        }

        const { rows, total } = await this.fetchPage({
            filter: {
                status: query.status,
                authorId: actor.role === Role.ADMIN ? undefined : actor.id,
            },
            order: 'created',
            terms: this.termsFor(query.q),
            page: query.page,
            limit: query.limit,
        });

        return paginate(rows, total, query.page, query.limit);
    }

    /** No search text means no terms. Search text with nothing searchable in it is the caller's mistake. */
    private termsFor(q: string | null | undefined): string[] {
        if (q === undefined || q === null) return [];

        const terms = parseSearchTerms(q);
        if (terms.length === 0) throw new BadRequestException(SEARCH_NEEDS_A_WORD);

        return terms;
    }

    private async fetchPage(args: {
        filter: Filter;
        order: Order;
        terms: string[];
        page: number;
        limit: number;
    }): Promise<{ rows: ListRow[]; total: number }> {
        const { filter, order, terms, page, limit } = args;
        const skip = (page - 1) * limit;

        if (terms.length > 0) return this.search({ filter, order, terms, skip, limit });

        // Fields set to undefined are ignored by Prisma, so only the filters that were given apply
        const where: Prisma.PostWhereInput = { status: filter.status, authorId: filter.authorId };

        // One transaction, so `total` and the page come from the same snapshot
        const [total, rows] = await this.prisma.$transaction([
            this.prisma.post.count({ where }),
            this.prisma.post.findMany({
                where,
                orderBy: ORDER_BY[order],
                skip,
                take: limit,
                select: listSelect,
            }),
        ]);

        return { rows, total };
    }

    private async search(args: {
        filter: Filter;
        order: Order;
        terms: string[];
        skip: number;
        limit: number;
    }): Promise<{ rows: ListRow[]; total: number }> {
        const { filter, order, terms, skip, limit } = args;

        // Every value below travels as a bound parameter. User text never becomes SQL.
        const match = Prisma.sql`MATCH(title, content) AGAINST (${buildBooleanQuery(terms)} IN BOOLEAN MODE)`;

        const conditions = [match];
        if (filter.status) conditions.push(Prisma.sql`status = ${filter.status}`);
        if (filter.authorId) conditions.push(Prisma.sql`authorId = ${filter.authorId}`);
        const where = Prisma.join(conditions, ' AND ');

        const [totals, idRows] = await this.prisma.$transaction([
            this.prisma.$queryRaw<{ total: bigint }[]>(
                Prisma.sql`SELECT COUNT(*) AS total FROM posts WHERE ${where}`,
            ),
            this.prisma.$queryRaw<{ id: string }[]>(
                Prisma.sql`SELECT id FROM posts WHERE ${where} ORDER BY ${match} DESC, ${TIEBREAK[order]} LIMIT ${limit} OFFSET ${skip}`,
            ),
        ]);

        const total = Number(totals[0]?.total ?? 0); // COUNT(*) comes back as a BigInt
        const ids = idRows.map((row) => row.id);
        if (ids.length === 0) return { rows: [], total };

        // Prisma returns rows in any order, so put them back in the order the database ranked them
        const found = await this.prisma.post.findMany({
            where: { id: { in: ids } },
            select: listSelect,
        });
        const byId = new Map(found.map((row) => [row.id, row] as const));

        const rows: ListRow[] = [];
        for (const id of ids) {
            const row = byId.get(id);
            if (row) rows.push(row); // skipped if the post was deleted between the two queries
        }

        return { rows, total };
    }
}