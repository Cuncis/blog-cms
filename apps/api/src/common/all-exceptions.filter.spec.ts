import {
    BadRequestException,
    ConflictException,
    HttpException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { toErrorPayload } from './all-exceptions.filter.js';

describe('toErrorPayload', () => {
    it('maps deliberate HTTP exceptions to their status, name, and message', () => {
        expect(toErrorPayload(new NotFoundException('Post not found.'))).toEqual({
            statusCode: 404,
            error: 'Not Found',
            message: 'Post not found.',
        });
        expect(toErrorPayload(new UnauthorizedException('Authentication required.')).statusCode).toBe(401);
        expect(toErrorPayload(new ConflictException('taken')).statusCode).toBe(409);
        expect(toErrorPayload(new HttpException('nope', 403))).toEqual({
            statusCode: 403,
            error: 'Forbidden',
            message: 'nope',
        });
    });

    it('maps the rate limiter exception to a 429', () => {
        const payload = toErrorPayload(new ThrottlerException('Too many requests.'));

        expect(payload.statusCode).toBe(429);
        expect(payload.message).toBe('Too many requests.');
    });

    it('keeps validation messages as an array', () => {
        const payload = toErrorPayload(new BadRequestException(['email must be an email', 'name too short']));

        expect(payload.statusCode).toBe(400);
        expect(payload.message).toEqual(['email must be an email', 'name too short']);
    });

    it('maps body-parser style client errors (oversized or malformed bodies)', () => {
        const tooLarge = Object.assign(new Error('request entity too large'), { status: 413 });

        expect(toErrorPayload(tooLarge)).toEqual({
            statusCode: 413,
            error: 'Payload Too Large',
            message: 'request entity too large',
        });
    });

    it('hides the details of unexpected errors, including library errors with a 5xx status', () => {
        const payload = toErrorPayload(new Error('password=hunter2 at db.internal:3306'));

        expect(payload).toEqual({
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'Internal server error',
        });
        expect(toErrorPayload(Object.assign(new Error('upstream'), { status: 502 })).statusCode).toBe(500);
    });

    it('survives values that are not errors at all', () => {
        expect(toErrorPayload('a thrown string').statusCode).toBe(500);
        expect(toErrorPayload(undefined).statusCode).toBe(500);
        expect(toErrorPayload(null).statusCode).toBe(500);
    });
});