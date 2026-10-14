import { jitterTtl } from './jitter.js';

describe('jitterTtl', () => {
    it('spreads the ttl by up to 10% either way', () => {
        expect(jitterTtl(100, () => 0)).toBe(90);
        expect(jitterTtl(100, () => 0.5)).toBe(100);
        expect(jitterTtl(100, () => 0.999999)).toBe(110);
    });

    it('stays inside that range with real randomness, in whole seconds', () => {
        for (let i = 0; i < 1_000; i++) {
            const ttl = jitterTtl(60);

            expect(Number.isInteger(ttl)).toBe(true);
            expect(ttl).toBeGreaterThanOrEqual(54);
            expect(ttl).toBeLessThanOrEqual(66);
        }
    });

    it('actually varies', () => {
        const ttls = new Set(Array.from({ length: 200 }, () => jitterTtl(100)));

        expect(ttls.size).toBeGreaterThan(5);
    });

    it('never goes below 1 second', () => {
        expect(jitterTtl(1, () => 0)).toBe(1);
        expect(jitterTtl(0)).toBe(1);
    });
});