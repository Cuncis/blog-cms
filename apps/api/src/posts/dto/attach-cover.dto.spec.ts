import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AttachCoverDto } from './attach-cover.dto.js';

const check = (body: Record<string, unknown>) => validateSync(plainToInstance(AttachCoverDto, body));

describe('AttachCoverDto', () => {
    it('accepts a UUID', () => {
        expect(check({ uploadId: '22222222-2222-4222-8222-222222222222' })).toHaveLength(0);
    });

    it.each(['', 'nope', '123', 42, null, undefined, ['22222222-2222-4222-8222-222222222222']])(
        'rejects %p',
        (uploadId) => {
            expect(check({ uploadId }).length).toBeGreaterThan(0);
        },
    );
});