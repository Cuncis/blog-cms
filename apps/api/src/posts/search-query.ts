// InnoDB never indexes words shorter than innodb_ft_min_token_size (3 by default)
export const MIN_TERM_LENGTH = 3;
export const MAX_TERM_LENGTH = 50;
export const MAX_TERMS = 8;

// InnoDB's built-in stopword list: words it never puts into a full-text index.
// Check it against your server with:
//   SELECT value FROM information_schema.INNODB_FT_DEFAULT_STOPWORD;
export const STOPWORDS: ReadonlySet<string> = new Set([
    'a', 'about', 'an', 'are', 'as', 'at', 'be', 'by', 'com', 'de', 'en', 'for', 'from', 'how',
    'i', 'in', 'is', 'it', 'la', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'und', 'was',
    'what', 'when', 'where', 'who', 'will', 'with', 'www',
]);

const WORD = /[\p{L}\p{N}_]+/gu;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Turns what a user typed into the words worth searching for.
 * Keeps only letters, digits, and underscores, so no MySQL boolean operator can survive.
 */
export function parseSearchTerms(input: string): string[] {
    // NFKC first: full-width look-alikes such as "＋" become plain "+", which the WORD pattern then drops
    const words = input.normalize('NFKC').toLowerCase().match(WORD) ?? [];
    const terms: string[] = [];

    for (const word of words) {
        const characters = Array.from(word); // code points, which is how MySQL counts characters

        if (characters.length < MIN_TERM_LENGTH) continue;
        if (!HAS_LETTER_OR_DIGIT.test(word)) continue; // "____" is not a word

        const term = characters.slice(0, MAX_TERM_LENGTH).join('');
        if (STOPWORDS.has(term) || terms.includes(term)) continue;

        terms.push(term);
        if (terms.length === MAX_TERMS) break;
    }

    return terms;
}

/** ["redis", "cach"] -> "+redis* +cach*": every word is required, and each matches as a prefix. */
export function buildBooleanQuery(terms: readonly string[]): string {
    return terms.map((term) => `+${term}*`).join(' ');
}