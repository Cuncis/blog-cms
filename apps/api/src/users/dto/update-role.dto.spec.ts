import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateRoleDto } from './update-role.dto.js';

const check = (body: Record<string, unknown>) => validateSync(plainToInstance(UpdateRoleDto, body));

describe('UpdateRoleDto', () => {
    it.each(['ADMIN', 'EDITOR', 'READER'])('accepts %s', (role) => {
        expect(check({ role })).toHaveLength(0);
    });

    it.each(['admin', 'SUPERUSER', '', 1, null, undefined, ['ADMIN']])('rejects %p', (role) => {
        expect(check({ role }).length).toBeGreaterThan(0);
    });

    it('names the allowed roles in the error', () => {
        const [error] = check({ role: 'nope' });

        expect(Object.values(error?.constraints ?? {}).join(' ')).toContain('ADMIN, EDITOR, READER');
    });
});