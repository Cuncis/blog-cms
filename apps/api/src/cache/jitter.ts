export const JITTER_RATIO = 0.1;

/** Spreads a TTL by up to 10% either way, so entries created together don't all expire together. */
export function jitterTtl(baseSeconds: number, random: () => number = Math.random): number {
    const factor = 1 - JITTER_RATIO + random() * 2 * JITTER_RATIO; // 0.9 up to (not including) 1.1

    return Math.max(1, Math.round(baseSeconds * factor));
}