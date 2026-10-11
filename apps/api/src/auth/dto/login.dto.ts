import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trimAndLowercase = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
    @Transform(trimAndLowercase)
    @IsEmail({}, { message: 'email must be a valid email address' })
    @MaxLength(254)
    email!: string;

    // Not transformed, and no minimum length: the registration policy may tighten
    // over time, and existing users must still be able to log in.
    @IsString()
    @IsNotEmpty({ message: 'password should not be empty' })
    @MaxLength(128, { message: 'password must be at most 128 characters' })
    password!: string;
}