import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
    const service = new PasswordService();

    it('produces a salted Argon2id hash with our parameters', async () => {
        const [a, b] = await Promise.all([
            service.hash('correct horse battery'),
            service.hash('correct horse battery'),
        ]);

        expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
        expect(a).not.toContain('correct horse battery');
        expect(a).not.toBe(b); // every hash has its own salt
    });

    it('verifies the right password and rejects wrong ones', async () => {
        const hash = await service.hash('correct horse battery');

        await expect(service.verify(hash, 'correct horse battery')).resolves.toBe(true);
        await expect(service.verify(hash, 'correct horse batterY')).resolves.toBe(false);
        await expect(service.verify(hash, '')).resolves.toBe(false);
    });

    it('treats a corrupted hash as a failed verification instead of throwing', async () => {
        await expect(service.verify('not-a-hash', 'whatever')).resolves.toBe(false);
        await expect(service.verify('', 'whatever')).resolves.toBe(false);
    });

    it('verifyDummy always returns false', async () => {
        await service.onModuleInit();

        await expect(service.verifyDummy('correct horse battery')).resolves.toBe(false);
        await expect(service.verifyDummy('')).resolves.toBe(false);
    });
});