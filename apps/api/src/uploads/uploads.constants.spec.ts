import {
    ALLOWED_COVER_TYPES,
    coverKey,
    COVER_PREFIX,
    MAX_COVER_BYTES,
    PENDING_MAX_AGE_MS,
    PRESIGN_TTL_SECONDS,
    tempKey,
    TEMP_PREFIX,
    UNATTACHED_MAX_AGE_MS,
} from './uploads.constants.js';

describe('upload keys', () => {
    it('puts unverified files in quarantine and verified ones under covers/', () => {
        expect(tempKey('abc')).toBe('tmp/abc');
        expect(coverKey('abc')).toBe('covers/abc');
    });

    it('never lets the two areas overlap', () => {
        expect(TEMP_PREFIX.startsWith(COVER_PREFIX)).toBe(false);
        expect(COVER_PREFIX.startsWith(TEMP_PREFIX)).toBe(false);
    });
});

describe('upload limits', () => {
    it('lets the signed policy expire long before a ticket does, so cleanup can never race an upload', () => {
        expect(PRESIGN_TTL_SECONDS * 1000).toBeLessThan(PENDING_MAX_AGE_MS);
    });

    it('keeps unused confirmed images at least as long as unfinished tickets', () => {
        expect(UNATTACHED_MAX_AGE_MS).toBeGreaterThanOrEqual(PENDING_MAX_AGE_MS);
    });

    it('accepts only raster formats: no SVG (it can carry scripts) and no GIF', () => {
        expect([...ALLOWED_COVER_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    });

    it('caps covers at 5 MB', () => {
        expect(MAX_COVER_BYTES).toBe(5 * 1024 * 1024);
    });
});