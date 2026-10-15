import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MAX_COVER_BYTES } from '../uploads.constants.js';
import { CreateCoverUploadDto } from './create-cover-upload.dto.js';

const check = (body: Record<string, unknown>) => validateSync(plainToInstance(CreateCoverUploadDto, body));

describe('CreateCoverUploadDto', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (contentType) => {
        expect(check({ contentType, size: 1000 })).toHaveLength(0);
    });

    it('accepts the smallest and the largest allowed size', () => {
        expect(check({ contentType: 'image/png', size: 1 })).toHaveLength(0);
        expect(check({ contentType: 'image/png', size: MAX_COVER_BYTES })).toHaveLength(0);
    });

    it.each(['image/gif', 'image/svg+xml', 'text/html', 'application/pdf', 'IMAGE/PNG', 'image/png; charset=x', '', null, 1, ['image/png']])(
        'rejects the content type %p',
        (contentType) => {
            expect(check({ contentType, size: 1000 }).length).toBeGreaterThan(0);
        },
    );

    it.each([0, -1, 1.5, MAX_COVER_BYTES + 1, '1000', null, undefined, NaN])('rejects the size %p', (size) => {
        expect(check({ contentType: 'image/png', size }).length).toBeGreaterThan(0);
    });

    it('names the allowed types and the size limit in its errors', () => {
        const messages = check({ contentType: 'image/gif', size: MAX_COVER_BYTES + 1 })
            .flatMap((error) => Object.values(error.constraints ?? {}))
            .join(' ');

        expect(messages).toContain('image/jpeg, image/png, image/webp');
        expect(messages).toContain(String(MAX_COVER_BYTES));
    });

    it('rejects a missing field', () => {
        expect(check({ size: 1000 }).length).toBeGreaterThan(0);
        expect(check({ contentType: 'image/png' }).length).toBeGreaterThan(0);
    });
});