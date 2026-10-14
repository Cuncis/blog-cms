import { normalizeSlug } from './slug.util.js';

describe('normalizeSlug', () => {
    it('lowercases a valid slug', () => {
        expect(normalizeSlug('Hello-World')).toBe('hello-world');
        expect(normalizeSlug('post-2')).toBe('post-2');
    });

    it('accepts a slug of exactly the maximum length', () => {
        expect(normalizeSlug('a'.repeat(200))).toBe('a'.repeat(200));
    });

    it.each(['', 'has space', '../etc/passwd', '-leading', 'trailing-', 'double--hyphen', 'a'.repeat(201), 'caf\u00E9'])(
        'returns null for the impossible slug %p',
        (raw) => {
            expect(normalizeSlug(raw)).toBeNull();
        },
    );
});