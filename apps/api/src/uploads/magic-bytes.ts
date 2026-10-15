import type { CoverContentType } from './uploads.constants.js';

// WebP needs 12 bytes ("RIFF", 4 size bytes, "WEBP"): the longest signature we check
export const MAGIC_BYTES_LENGTH = 12;

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

const hasBytesAt = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * What a file REALLY is, judging by its first bytes, whatever its name or Content-Type claims.
 * Only the formats we accept are recognized. Anything else, SVG and GIF included, is null.
 */
export function detectImageType(bytes: Uint8Array): CoverContentType | null {
    if (hasBytesAt(bytes, JPEG)) return 'image/jpeg';
    if (hasBytesAt(bytes, PNG)) return 'image/png';
    if (hasBytesAt(bytes, RIFF) && hasBytesAt(bytes, WEBP, 8)) return 'image/webp';

    return null;
}