export const MANAGE_UPLOADS_PATH = 'manage/uploads';

export const ALLOWED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type CoverContentType = (typeof ALLOWED_COVER_TYPES)[number];

export const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MB

// How long the signed upload policy stays valid
export const PRESIGN_TTL_SECONDS = 300;

// A ticket that is not confirmed within this time is dead. It is much longer than the signed
// policy lives, so nothing can still be uploading when cleanup removes the ticket.
export const PENDING_MAX_AGE_MS = 60 * 60 * 1000;

// A confirmed upload that no post uses is removed after this long
export const UNATTACHED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const MAX_PENDING_UPLOADS = 10;

// Cover keys are unique per upload and never change, so browsers and CDNs may keep them forever
export const COVER_CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Uploads land in quarantine (never publicly readable). Only verified files are copied under covers/.
export const TEMP_PREFIX = 'tmp/';
export const COVER_PREFIX = 'covers/';
export const tempKey = (id: string) => `${TEMP_PREFIX}${id}`;
export const coverKey = (id: string) => `${COVER_PREFIX}${id}`;

export const UPLOAD_NOT_FOUND = 'Upload not found.';
export const STORAGE_UNAVAILABLE = 'File storage is temporarily unavailable. Please try again.';