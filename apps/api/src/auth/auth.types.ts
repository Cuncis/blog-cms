import type { Role } from '@prisma/client';
import type { PublicUser } from '../users/users.types.js';

// What the client receives in the response body
export type LoginResult = {
    accessToken: string;
    expiresIn: number; // seconds
    user: PublicUser;
};

// What the service hands to the controller: the body, plus the cookie-only refresh token
export type AuthSession = {
    result: LoginResult;
    refreshToken: string;
};

// What the guard attaches to the request after verifying the access token.
// The role comes from the token, so it can be up to one token lifetime out of date.
export type AuthenticatedUser = {
    id: string;
    role: Role;
};