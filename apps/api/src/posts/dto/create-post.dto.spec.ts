import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CONTENT_MAX, EXCERPT_MAX, TITLE_MAX } from '../posts.constants.js';
import { CreatePostDto } from './create-post.dto.js';

const valid = { title: 'Hello', content: 'Some content' };

function check(body: Record<string, unknown>) {
    const dto = plainToInstance(CreatePostDto, body);
    return { dto, errors: validateSync(dto) };
}

describe('CreatePostDto', () => {
    it('accepts a valid body, with or without an excerpt', () => {
        expect(check(valid).errors).toHaveLength(0);
        expect(check({ ...valid, excerpt: 'Short summary' }).errors).toHaveLength(0);
    });

    it('trims the title, the excerpt, and the content', () => {
        const { dto } = check({ title: '  Hello  ', excerpt: '  Summary ', content: '\n Body \n' });

        expect(dto.title).toBe('Hello');
        expect(dto.excerpt).toBe('Summary');
        expect(dto.content).toBe('Body');
    });

    it('turns an empty excerpt into null ("no excerpt")', () => {
        expect(check({ ...valid, excerpt: '' }).dto.excerpt).toBeNull();
        expect(check({ ...valid, excerpt: '   ' }).dto.excerpt).toBeNull();
        expect(check({ ...valid, excerpt: '' }).errors).toHaveLength(0);
    });

    it.each(['', '   ', 'a'.repeat(TITLE_MAX + 1)])('rejects the title %p', (title) => {
        expect(check({ ...valid, title }).errors.length).toBeGreaterThan(0);
    });

    it('accepts a title of exactly the maximum length', () => {
        expect(check({ ...valid, title: 'a'.repeat(TITLE_MAX) }).errors).toHaveLength(0);
    });

    it.each(['', '   ', 'a'.repeat(CONTENT_MAX + 1)])('rejects the content of length %#', (content) => {
        expect(check({ ...valid, content }).errors.length).toBeGreaterThan(0);
    });

    it('accepts content of exactly the maximum length', () => {
        expect(check({ ...valid, content: 'a'.repeat(CONTENT_MAX) }).errors).toHaveLength(0);
    });

    it('rejects an excerpt over the maximum length, and accepts one at the limit', () => {
        expect(check({ ...valid, excerpt: 'a'.repeat(EXCERPT_MAX + 1) }).errors.length).toBeGreaterThan(0);
        expect(check({ ...valid, excerpt: 'a'.repeat(EXCERPT_MAX) }).errors).toHaveLength(0);
    });

    it.each([{ title: 123 }, { content: { a: 1 } }, { excerpt: 5 }, { title: null }, { content: null }])(
        'rejects non-string values %p',
        (override) => {
            expect(check({ ...valid, ...override }).errors.length).toBeGreaterThan(0);
        },
    );

    it('rejects a missing title or content', () => {
        expect(check({ content: 'x' }).errors.length).toBeGreaterThan(0);
        expect(check({ title: 'x' }).errors.length).toBeGreaterThan(0);
    });
});