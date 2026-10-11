import { STATUS_CODES } from 'node:http';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

export type ErrorPayload = {
    statusCode: number;
    error: string;
    message: string | string[];
};

/** Errors from body-parser and similar libraries carry a numeric status but aren't HttpExceptions. */
function getClientErrorStatus(exception: unknown): number | null {
    if (typeof exception !== 'object' || exception === null) return null;

    const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
    const code = typeof status === 'number' ? status : statusCode;

    return typeof code === 'number' && code >= 400 && code < 500 ? code : null;
}

export function toErrorPayload(exception: unknown): ErrorPayload {
    // 1. Errors we threw on purpose (UnauthorizedException, validation errors, 429, ...)
    if (exception instanceof HttpException) {
        const statusCode = exception.getStatus();
        const response = exception.getResponse();

        if (typeof response === 'string') {
            return { statusCode, error: STATUS_CODES[statusCode] ?? 'Error', message: response };
        }

        const body = response as { message?: string | string[]; error?: string };
        return {
            statusCode,
            error: body.error ?? STATUS_CODES[statusCode] ?? 'Error',
            message: body.message ?? exception.message,
        };
    }

    // 2. Client mistakes raised by libraries, e.g. malformed JSON or an oversized body
    const clientStatus = getClientErrorStatus(exception);
    if (clientStatus !== null) {
        const message = (exception as { message?: unknown }).message;
        return {
            statusCode: clientStatus,
            error: STATUS_CODES[clientStatus] ?? 'Error',
            message: typeof message === 'string' ? message : (STATUS_CODES[clientStatus] ?? 'Error'),
        };
    }

    // 3. Everything else is a bug or an outage: never leak the details
    return {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal server error',
    };
}

@Catch() // no argument = catch everything
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    constructor(private readonly httpAdapterHost: HttpAdapterHost) { }

    catch(exception: unknown, host: ArgumentsHost): void {
        const { httpAdapter } = this.httpAdapterHost;
        const ctx = host.switchToHttp();
        const request: unknown = ctx.getRequest();

        const payload = toErrorPayload(exception);
        const path = httpAdapter.getRequestUrl(request) as string;

        if (payload.statusCode >= 500) {
            // The full story stays in our logs
            this.logger.error(
                `${httpAdapter.getRequestMethod(request) as string} ${path} -> ${payload.statusCode}`,
                exception instanceof Error ? exception.stack : String(exception),
            );
        }

        httpAdapter.reply(
            ctx.getResponse(),
            { ...payload, path, timestamp: new Date().toISOString() },
            payload.statusCode,
        );
    }
}