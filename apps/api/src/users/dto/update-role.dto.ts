import { Role } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateRoleDto {
    @IsEnum(Role, { message: `role must be one of: ${Object.values(Role).join(', ')}` })
    role!: Role;
}