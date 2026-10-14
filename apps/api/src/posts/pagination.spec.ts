import { paginate } from './pagination.js';

describe('paginate', () => {
    it('wraps the items with the paging metadata', () => {
        expect(paginate(['a', 'b'], 25, 3, 10)).toEqual({
            items: ['a', 'b'],
            meta: { total: 25, page: 3, limit: 10, totalPages: 3 },
        });
    });

    it.each([
        [0, 10, 0],
        [1, 10, 1],
        [10, 10, 1],
        [11, 10, 2],
        [17, 5, 4],
        [25, 5, 5],
    ])('%p results with a page size of %p make %p pages', (total, limit, pages) => {
        expect(paginate([], total, 1, limit).meta.totalPages).toBe(pages);
    });
});