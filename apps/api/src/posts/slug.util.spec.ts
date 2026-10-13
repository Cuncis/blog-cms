import { SLUG_MAX, SLUG_PATTERN } from './posts.constants.js';
import {
    CANDIDATE_COUNT,
    MAX_BASE_SLUG_LENGTH,
    pickSlug,
    randomSlugSuffix,
    slugCandidates,
    slugify,
} from './slug.util.js';

describe('slugify', () => {
    it.each([
        ['Hello, World!', 'hello-world'],
        ['  --Hello   World--  ', 'hello-world'],
        ['Crème Brûlée à la Mode', 'creme-brulee-a-la-mode'],
        ['Ünïcode Tést', 'unicode-test'],
        ['C++ tips & tricks', 'c-tips-tricks'],
        ['Version 2.0 released', 'version-2-0-released'],
        ['ﬁne print', 'fine-print'], // ligature
        ['ＡＢＣ 123', 'abc-123'], // full-width letters
    ])('turns %p into %p', (title, expected) => {
        expect(slugify(title)).toBe(expected);
    });

    it.each(['', '   ', '---', '你好', '🎉🎉', '!!!'])('falls back to "post" for %p', (title) => {
        expect(slugify(title)).toBe('post');
    });

    it('truncates long titles without leaving a trailing hyphen', () => {
        expect(slugify('a'.repeat(150))).toBe('a'.repeat(MAX_BASE_SLUG_LENGTH));

        const result = slugify('word '.repeat(40));
        expect(result.length).toBeLessThanOrEqual(MAX_BASE_SLUG_LENGTH);
        expect(result.endsWith('-')).toBe(false);
    });

    it('always produces a valid slug, even for hostile input', () => {
        const inputs = [
            'Hello, World!',
            '../../etc/passwd',
            "'; DROP TABLE posts; --",
            '<script>alert(1)</script>',
            '%00%2e%2e',
            'a'.repeat(500),
            '\n\t',
            'ß ø ı İ',
        ];

        for (const input of inputs) {
            expect(slugify(input)).toMatch(SLUG_PATTERN);
        }
    });

    it('leaves room for a collision suffix inside the column size', () => {
        const longest = `${slugify('a'.repeat(500))}-${randomSlugSuffix()}`;

        expect(longest.length).toBeLessThanOrEqual(SLUG_MAX);
    });
});

describe('slugCandidates', () => {
    it('lists the base and the numbered variants up to -10', () => {
        const candidates = slugCandidates('hello');

        expect(candidates).toHaveLength(CANDIDATE_COUNT);
        expect(candidates[0]).toBe('hello');
        expect(candidates[1]).toBe('hello-2');
        expect(candidates.at(-1)).toBe('hello-10');
    });
});

describe('pickSlug', () => {
    it('uses the base when it is free', () => {
        expect(pickSlug('hello', new Set())).toBe('hello');
    });

    it('adds the next number when the base is taken', () => {
        expect(pickSlug('hello', new Set(['hello']))).toBe('hello-2');
    });

    it('picks the first free number, even with gaps', () => {
        expect(pickSlug('hello', new Set(['hello', 'hello-3']))).toBe('hello-2');
        expect(pickSlug('hello', new Set(['hello', 'hello-2', 'hello-4']))).toBe('hello-3');
    });

    it('ignores slugs of other posts', () => {
        expect(pickSlug('hello', new Set(['hello-world', 'goodbye']))).toBe('hello');
    });

    it('falls back to a random suffix when every candidate is taken', () => {
        const taken = new Set(slugCandidates('hello'));

        expect(pickSlug('hello', taken, () => 'abc12345')).toBe('hello-abc12345');
    });
});

describe('randomSlugSuffix', () => {
    it('is 8 hex characters and differs between calls', () => {
        const suffixes = new Set(Array.from({ length: 50 }, randomSlugSuffix));

        expect(suffixes.size).toBe(50);
        for (const suffix of suffixes) expect(suffix).toMatch(/^[0-9a-f]{8}$/);
    });
});