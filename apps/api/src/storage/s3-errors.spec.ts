import { httpStatusOf, isBucketAlreadyOwnedError, isNotFoundError } from './s3-errors.js';

const sdkError = (name: string, status?: number) =>
    Object.assign(new Error(name), { name, ...(status === undefined ? {} : { $metadata: { httpStatusCode: status } }) });

describe('httpStatusOf', () => {
    it('reads the status from an SDK error', () => {
        expect(httpStatusOf(sdkError('Anything', 412))).toBe(412);
    });

    it.each([new Error('plain'), 'text', null, undefined, 42, { $metadata: {} }, { $metadata: { httpStatusCode: '404' } }])(
        'returns undefined for %p',
        (value) => {
            expect(httpStatusOf(value)).toBeUndefined();
        },
    );
});

describe('isNotFoundError', () => {
    it('recognizes a 404 whatever the error is called', () => {
        expect(isNotFoundError(sdkError('SomethingElse', 404))).toBe(true);
    });

    it.each(['NotFound', 'NoSuchKey', 'NoSuchBucket'])('recognizes the error name %s', (name) => {
        expect(isNotFoundError(sdkError(name))).toBe(true);
    });

    it.each([sdkError('AccessDenied', 403), sdkError('InternalError', 500), new Error('boom'), 'NotFound', null, undefined])(
        'does not mistake %p for a missing object',
        (value) => {
            expect(isNotFoundError(value)).toBe(false);
        },
    );
});

describe('isBucketAlreadyOwnedError', () => {
    it.each(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'])('recognizes %s', (name) => {
        expect(isBucketAlreadyOwnedError(sdkError(name, 409))).toBe(true);
    });

    it.each([sdkError('AccessDenied', 403), new Error('x'), null, 'BucketAlreadyOwnedByYou'])('ignores %p', (value) => {
        expect(isBucketAlreadyOwnedError(value)).toBe(false);
    });
});