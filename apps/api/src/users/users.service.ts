import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { publicUserSelect, type PublicUser } from './users.types.js';

type NewUser = {
    email: string;
    name: string;
    passwordHash: string;
    // No role here on purpose: everyone registers as READER (the database default)
};

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) { }

    create(data: NewUser): Promise<PublicUser> {
        return this.prisma.user.create({ data, select: publicUserSelect });
    }

    /**
     * Returns the FULL row including passwordHash. Internal use only (login):
     * never send this object to a client.
     */
    findByEmail(email: string): Promise<User | null> {
        return this.prisma.user.findUnique({ where: { email } });
    }

    findPublicById(id: string): Promise<PublicUser | null> {
        return this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
    }
}