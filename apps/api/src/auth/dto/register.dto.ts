import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const trimAndLowercase = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
    @Transform(trimAndLowercase)
    @IsEmail({}, { message: 'email must be a valid email address' })
    @MaxLength(254)
    email!: string;

    @Transform(trim)
    @IsString()
    @IsNotEmpty({ message: 'name should not be empty' })
    @MaxLength(100)
    name!: string;

    // Deliberately NOT transformed: spaces in a password may be intentional
    @IsString()
    @MinLength(10, { message: 'password must be at least 10 characters' })
    @MaxLength(128, { message: 'password must be at most 128 characters' })
    password!: string;

    // There is no `role` field. The global ValidationPipe (forbidNonWhitelisted) turns
    // {"role":"ADMIN"} into a 400, so nobody can pick their own role at registration.
}