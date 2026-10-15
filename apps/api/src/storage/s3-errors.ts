export function httpStatusOf(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;

    const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;

    return typeof status === 'number' ? status : undefined;
}

function nameOf(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;

    const { name } = error as { name?: unknown };

    return typeof name === 'string' ? name : undefined;
}

/** The object (or bucket) does not exist. */
export function isNotFoundError(error: unknown): boolean {
    if (httpStatusOf(error) === 404) return true;

    const name = nameOf(error);
    return name === 'NotFound' || name === 'NoSuchKey' || name === 'NoSuchBucket';
}

/** Two instances created the same bucket at the same moment: not a problem. */
export function isBucketAlreadyOwnedError(error: unknown): boolean {
    const name = nameOf(error);

    return name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists';
}