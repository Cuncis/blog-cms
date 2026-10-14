import { parseJson, toJson } from './serialize.js';

describe('toJson', () => {
    it('returns exactly what JSON would deliver: dates become ISO strings, undefined disappears', () => {
        const value = {
            when: new Date('2026-01-01T00:00:00Z'),
            gone: undefined,
            nested: { list: [new Date('2026-02-01T00:00:00Z')] },
        };

        expect(toJson(value)).toEqual({
            when: '2026-01-01T00:00:00.000Z',
            nested: { list: ['2026-02-01T00:00:00.000Z'] },
        });
    });

    it('makes a copy that shares nothing with the original', () => {
        const original = { nested: { n: 1 } };
        const copy = toJson(original);

        copy.nested.n = 2;

        expect(original.nested.n).toBe(1);
    });
});

describe('parseJson', () => {
    it('parses objects and arrays', () => {
        expect(parseJson('{"a":1}')).toEqual({ a: 1 });
        expect(parseJson('[1,2]')).toEqual([1, 2]);
    });

    it.each(['{broken', '', 'null', '"text"', '42', 'true'])('treats %p as unusable', (text) => {
        expect(parseJson(text)).toBeUndefined();
    });
});