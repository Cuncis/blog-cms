import type { Prisma } from '@prisma/client';

// The only user fields that may ever leave the server
export const publicUserSelect = {
    id: true,
    email: true,
    name: true,
    role: true,
    createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;