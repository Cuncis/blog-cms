export type PaginationMeta = {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
};

export type Paginated<T> = {
    items: T[];
    meta: PaginationMeta;
};

export function paginate<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}