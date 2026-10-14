import {
    buildBooleanQuery,
    MAX_TERM_LENGTH,
    MAX_TERMS,
    parseSearchTerms,
    STOPWORDS,
} from './search-query.js';

describe('parseSearchTerms', () => {
    it('lowercases and splits on anything that is not a letter, digit, or underscore', () => {
        expect(parseSearchTerms('Redis, Caching & MinIO!')).toEqual(['redis', 'caching', 'minio']);
    });

    it('drops words shorter than 3 characters, which InnoDB never indexes', () => {
        expect(parseSearchTerms('go to db cache')).toEqual(['cache']);
    });

    it('drops stopwords, which InnoDB never indexes either', () => {
        expect(parseSearchTerms('the quick brown fox')).toEqual(['quick', 'brown', 'fox']);
        expect(parseSearchTerms('www.example.com')).toEqual(['example']);
    });

    it('strips every boolean-mode operator, so none can reach MySQL', () => {
        const input = '+redis -minio >cache <old (grp) ~x *wild "phrase" @dist';

        expect(parseSearchTerms(input)).toEqual([
            'redis', 'minio', 'cache', 'old', 'grp', 'wild', 'phrase', 'dist',
        ]);
    });

    it('neutralizes full-width look-alike operators too', () => {
        const input = '\uFF0B\uFF02hello\uFF02 \uFF57\uFF4F\uFF52\uFF4C\uFF44'; // ＋＂hello＂ ｗｏｒｌｄ

        expect(parseSearchTerms(input)).toEqual(['hello', 'world']);
    });

    it('removes duplicates, ignoring letter case', () => {
        expect(parseSearchTerms('redis Redis REDIS')).toEqual(['redis']);
    });

    it('keeps digits and underscores inside words', () => {
        expect(parseSearchTerms('snake_case 2026')).toEqual(['snake_case', '2026']);
    });

    it('ignores tokens that are only underscores', () => {
        expect(parseSearchTerms('____ redis')).toEqual(['redis']);
    });

    it('keeps accented letters and other scripts', () => {
        const input = 'Na\u00EFve CAF\u00C9 \u65E5\u672C\u8A9E';

        expect(parseSearchTerms(input)).toEqual(['na\u00EFve', 'caf\u00E9', '\u65E5\u672C\u8A9E']);
    });

    it(`keeps at most ${MAX_TERMS} terms`, () => {
        const terms = parseSearchTerms('aaa bbb ccc ddd eee fff ggg hhh iii jjj');

        expect(terms).toEqual(['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh']);
    });

    it(`truncates a word to ${MAX_TERM_LENGTH} characters`, () => {
        expect(parseSearchTerms('a'.repeat(80))).toEqual(['a'.repeat(MAX_TERM_LENGTH)]);
    });

    it.each(['', '   ', 'a to be', '!!!', '\u{1F389}', 'the', 'ab', '++ -- ""'])(
        'finds nothing searchable in %p',
        (input) => {
            expect(parseSearchTerms(input)).toEqual([]);
        },
    );
});

describe('buildBooleanQuery', () => {
    it('requires every word and matches each as a prefix', () => {
        expect(buildBooleanQuery(['redis', 'caching'])).toBe('+redis* +caching*');
    });

    it('returns an empty string when there are no terms', () => {
        expect(buildBooleanQuery([])).toBe('');
    });

    it('can only ever contain required prefix terms, whatever the user typed', () => {
        const hostile = [
            '+redis -minio',
            '"exact phrase" (grouped) >up <down ~tilde *star @distance',
            "'; DROP TABLE posts; --",
            '\u0000redis\u0000',
            'redis\nminio',
            'a'.repeat(5000),
            '\u{1F389} emoji redis',
            'redis* AND (minio OR cache)',
        ];

        for (const input of hostile) {
            const query = buildBooleanQuery(parseSearchTerms(input));

            expect(query).toMatch(/^$|^\+[\p{L}\p{N}_]+\*( \+[\p{L}\p{N}_]+\*)*$/u);
        }
    });
});

describe('STOPWORDS', () => {
    it("matches InnoDB's 35 distinct default stopwords", () => {
        expect([...STOPWORDS].sort()).toEqual([
            'a', 'about', 'an', 'are', 'as', 'at', 'be', 'by', 'com', 'de', 'en', 'for', 'from', 'how',
            'i', 'in', 'is', 'it', 'la', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'und', 'was',
            'what', 'when', 'where', 'who', 'will', 'with', 'www',
        ]);
    });
});