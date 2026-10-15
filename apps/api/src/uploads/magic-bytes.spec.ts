import { detectImageType } from './magic-bytes.js';

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const webp = (size: number[] = [0x1a, 0, 0, 0]) => bytes(ascii('RIFF'), size, ascii('WEBP'), ascii('VP8L'));

describe('detectImageType', () => {
    it.each([0xe0, 0xe1, 0xdb, 0xee])('recognizes a JPEG whose fourth byte is %p', (marker) => {
        expect(detectImageType(bytes([0xff, 0xd8, 0xff, marker], [0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    });

    it('recognizes a PNG', () => {
        expect(detectImageType(bytes(PNG_HEAD, [0, 0, 0, 0]))).toBe('image/png');
    });

    it('recognizes a WebP, whatever size its RIFF header announces', () => {
        expect(detectImageType(webp())).toBe('image/webp');
        expect(detectImageType(webp([0xff, 0xff, 0xff, 0x7f]))).toBe('image/webp');
    });

    it('needs the whole signature: truncated files are rejected', () => {
        expect(detectImageType(bytes([0xff, 0xd8]))).toBeNull();
        expect(detectImageType(bytes(PNG_HEAD.slice(0, 7)))).toBeNull();
        expect(detectImageType(webp().slice(0, 11))).toBeNull();
    });

    const notImages: Array<[string, number[]]> = [
        ['an empty file', []],
        ['a GIF', ascii('GIF89a')],
        ['HTML', ascii('<html><script>alert(1)</script></html>')],
        ['an SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg">')],
        ['a PDF', ascii('%PDF-1.7')],
        ['a ZIP', [0x50, 0x4b, 0x03, 0x04]],
        ['plain text', ascii('hello world')],
        ['a WAV file (also a RIFF container)', [...ascii('RIFF'), 0x1a, 0, 0, 0, ...ascii('WAVEfmt ')]],
    ];

    it.each(notImages)('rejects %s', (_label, content) => {
        expect(detectImageType(Uint8Array.from(content))).toBeNull();
    });

    it('only looks at the start of the file: a signature further in proves nothing', () => {
        expect(detectImageType(bytes(ascii('hello'), JPEG_HEAD))).toBeNull();
        expect(detectImageType(bytes(ascii('<html>'), PNG_HEAD))).toBeNull();
    });
});