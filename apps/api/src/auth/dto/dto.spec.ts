import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginDto } from './login.dto.js';
import { RegisterDto } from './register.dto.js';

function check<T extends object>(cls: new () => T, body: Record<string, unknown>) {
    const dto = plainToInstance(cls, body);
    return { dto, errors: validateSync(dto) };
}

describe('RegisterDto', () => {
    const valid = { email: 'ann@example.com', name: 'Ann', password: 'a-long-enough-password' };

    it('accepts a valid body', () => {
        expect(check(RegisterDto, valid).errors).toHaveLength(0);
    });

    it('trims and lowercases the email, trims the name, and leaves the password alone', () => {
        const { dto, errors } = check(RegisterDto, {
            email: '  Ann@Example.COM ',
            name: '  Ann Lee ',
            password: '  spaces are fine  ',
        });

        expect(errors).toHaveLength(0);
        expect(dto.email).toBe('ann@example.com');
        expect(dto.name).toBe('Ann Lee');
        expect(dto.password).toBe('  spaces are fine  ');
    });

    it.each(['', 'not-an-email', 'a@', '@example.com', 'a b@example.com'])('rejects the email %p', (email) => {
        expect(check(RegisterDto, { ...valid, email }).errors.length).toBeGreaterThan(0);
    });

    it.each(['', '   ', 'a'.repeat(101)])('rejects the name %p', (name) => {
        expect(check(RegisterDto, { ...valid, name }).errors.length).toBeGreaterThan(0);
    });

    it('enforces a password length of 10 to 128 characters', () => {
        expect(check(RegisterDto, { ...valid, password: 'a'.repeat(9) }).errors.length).toBeGreaterThan(0);
        expect(check(RegisterDto, { ...valid, password: 'a'.repeat(10) }).errors).toHaveLength(0);
        expect(check(RegisterDto, { ...valid, password: 'a'.repeat(128) }).errors).toHaveLength(0);
        expect(check(RegisterDto, { ...valid, password: 'a'.repeat(129) }).errors.length).toBeGreaterThan(0);
    });

    it.each([{ email: 123 }, { name: 42 }, { password: null }])('rejects non-string values %p', (override) => {
        expect(check(RegisterDto, { ...valid, ...override }).errors.length).toBeGreaterThan(0);
    });
});

describe('LoginDto', () => {
    const valid = { email: 'ann@example.com', password: 'whatever it was' };

    it('accepts a valid body, including a short password', () => {
        expect(check(LoginDto, valid).errors).toHaveLength(0);
        expect(check(LoginDto, { ...valid, password: 'x' }).errors).toHaveLength(0);
    });

    it('trims and lowercases the email but not the password', () => {
        const { dto } = check(LoginDto, { email: '  Ann@Example.COM ', password: '  padded  ' });

        expect(dto.email).toBe('ann@example.com');
        expect(dto.password).toBe('  padded  ');
    });

    it.each(['', 'not-an-email', 'a@'])('rejects the email %p', (email) => {
        expect(check(LoginDto, { ...valid, email }).errors.length).toBeGreaterThan(0);
    });

    it('rejects an empty or over-long password', () => {
        expect(check(LoginDto, { ...valid, password: '' }).errors.length).toBeGreaterThan(0);
        expect(check(LoginDto, { ...valid, password: 'a'.repeat(129) }).errors.length).toBeGreaterThan(0);
    });
});