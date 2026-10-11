import { extractBearerToken } from './extract-bearer.js';

describe('extractBearerToken', () => {
    it('returns the token from a Bearer header, whatever the letter case of the scheme', () => {
        expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
        expect(extractBearerToken('bearer abc')).toBe('abc');
        expect(extractBearerToken('BEARER abc')).toBe('abc');
    });

    it.each([
        undefined,
        '',
        'Bearer',
        'Bearer ',
        'Bearer  double-space',
        'Bearer two tokens',
        'Basic dXNlcjpwYXNz',
        'abc.def.ghi',
        'Bearerabc',
    ])('returns null for %p', (header) => {
        expect(extractBearerToken(header)).toBeNull();
    });
});