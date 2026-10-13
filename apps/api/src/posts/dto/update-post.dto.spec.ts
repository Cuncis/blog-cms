import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CONTENT_MAX, TITLE_MAX } from '../posts.constants.js';
import { UpdatePostDto } from './update-post.dto.js';

function check(body: Record<string, unknown>) {
    const dto = plainToInstance(UpdatePostDto, body);
    return { dto, errors: validateSync(dto) };
}

describe('UpdatePostDto', () => {
    it('accepts any single field, or an empty object (the service rejects "nothing to change")', () => {
        expect(check({ title: 'New' }).errors).toHaveLength(0);
        expect(check({ content: 'New' }).errors).toHaveLength(0);
        expect(check({ excerpt: 'New' }).errors).toHaveLength(0);
        expect(check({}).errors).toHaveLength(0);
    });

    it('trims every text field', () => {
        const { dto } = check({ title: '  New  ', excerpt: ' Sum ', content: ' Body ' });

        expect(dto).toMatchObject({ title: 'New', excerpt: 'Sum', content: 'Body' });
    });

    it('lets the excerpt be cleared with null or an empty string', () => {
        expect(check({ excerpt: null }).errors).toHaveLength(0);
        expect(check({ excerpt: null }).dto.excerpt).toBeNull();
        expect(check({ excerpt: '' }).dto.excerpt).toBeNull();
    });

    it('does not let the title or content be cleared', () => {
        expect(check({ title: null }).errors.length).toBeGreaterThan(0);
        expect(check({ content: null }).errors.length).toBeGreaterThan(0);
        expect(check({ title: '' }).errors.length).toBeGreaterThan(0);
        expect(check({ title: '   ' }).errors.length).toBeGreaterThan(0);
        expect(check({ content: '   ' }).errors.length).toBeGreaterThan(0);
    });

    it('enforces the length limits', () => {
        expect(check({ title: 'a'.repeat(TITLE_MAX + 1) }).errors.length).toBeGreaterThan(0);
        expect(check({ content: 'a'.repeat(CONTENT_MAX + 1) }).errors.length).toBeGreaterThan(0);
        expect(check({ title: 'a'.repeat(TITLE_MAX) }).errors).toHaveLength(0);
    });

    it.each([{ title: 5 }, { content: [] }, { excerpt: 5 }])('rejects non-string values %p', (body) => {
        expect(check(body).errors.length).toBeGreaterThan(0);
    });
});