import { randomBytes } from 'node:crypto';
import { SLUG_MAX, SLUG_PATTERN } from './posts.constants.js';

// Leaves room for a "-<suffix>" inside the 200-character column
export const MAX_BASE_SLUG_LENGTH = 100;
export const CANDIDATE_COUNT = 10;

/** "Crème Brûlée, 2nd Ed!" -> "creme-brulee-2nd-ed". Titles with no Latin letters become "post". */
export function slugify(title: string): string {
    const slug = title
        .normalize('NFKD') // splits "é" into "e" + an accent mark (and flattens ligatures and full-width letters)
        .replace(/[\u0300-\u036f]/g, '') // drops the accent marks
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // everything else becomes a single hyphen
        .replace(/^-+|-+$/g, '');

    const truncated = slug.slice(0, MAX_BASE_SLUG_LENGTH).replace(/-+$/g, '');

    return truncated === '' ? 'post' : truncated;
}

/** base, base-2, base-3, ... base-10 */
export function slugCandidates(base: string): string[] {
    return [base, ...Array.from({ length: CANDIDATE_COUNT - 1 }, (_, index) => `${base}-${index + 2}`)];
}

export function randomSlugSuffix(): string {
    return randomBytes(4).toString('hex'); // 8 hex characters
}

/** The first free candidate, or base plus a random suffix when all ten are taken. */
export function pickSlug(
    base: string,
    taken: ReadonlySet<string>,
    suffix: () => string = randomSlugSuffix,
): string {
    for (const candidate of slugCandidates(base)) {
        if (!taken.has(candidate)) return candidate;
    }

    return `${base}-${suffix()}`;
}

/** A slug taken from a URL, lowercased (slugs are stored lowercase), or null if it could not exist. */
export function normalizeSlug(raw: string): string | null {
    const slug = raw.toLowerCase();

    return slug.length > SLUG_MAX || !SLUG_PATTERN.test(slug) ? null : slug;
}