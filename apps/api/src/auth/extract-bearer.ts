/**
 * Returns the token from "Authorization: Bearer <token>", or null for anything else.
 * The scheme is case-insensitive (RFC 7235). Exactly one space, exactly one token.
 */
export function extractBearerToken(header: string | undefined): string | null {
    if (!header) return null;

    const match = /^Bearer (\S+)$/i.exec(header);
    return match?.[1] ?? null;
}