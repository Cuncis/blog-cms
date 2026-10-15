export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export type StoredObject = { size: number; contentType: string | undefined; etag: string };
export type PresignedUpload = { url: string; fields: Record<string, string> };
export type PresignRequest = { key: string; contentType: string; size: number; expiresInSeconds: number };
export type CopyRequest = {
    from: string;
    to: string;
    etag: string; // copy only if the source still has this ETag
    contentType: string;
    cacheControl: string;
};

/** The source of a copy changed (or vanished) after it was inspected. */
export class ObjectChangedError extends Error {
    constructor() {
        super('The stored object changed or disappeared while it was being verified.');
        this.name = 'ObjectChangedError';
    }
}

/** The few storage operations the app needs. Every method may throw while storage is unavailable. */
export interface ObjectStorage {
    presignedPost(request: PresignRequest): Promise<PresignedUpload>;
    /** null when the object does not exist */
    head(key: string): Promise<StoredObject | null>;
    readStart(key: string, length: number): Promise<Uint8Array>;
    /** Throws ObjectChangedError when the source no longer matches the ETag, or no longer exists. */
    copy(request: CopyRequest): Promise<void>;
    /** Deleting a key that does not exist is not an error. */
    delete(key: string): Promise<void>;
}