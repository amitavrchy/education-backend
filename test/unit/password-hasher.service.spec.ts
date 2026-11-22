import { PasswordHasherService } from '../../src/modules/auth/services/password-hasher.service.js';

describe('PasswordHasherService', () => {
  const hasher = new PasswordHasherService();

  it('hashes with a random salt and verifies the right password only', async () => {
    const first = await hasher.hash('correct horse battery');
    const second = await hasher.hash('correct horse battery');

    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toBe(second);
    await expect(hasher.verify('correct horse battery', first)).resolves.toBe(true);
    await expect(hasher.verify('wrong password', first)).resolves.toBe(false);
  });

  it('returns false (after doing the same work) when there is no stored hash', async () => {
    await expect(hasher.verify('anything', null)).resolves.toBe(false);
  });

  it('rejects malformed hashes', async () => {
    await expect(hasher.verify('anything', 'not-a-hash')).resolves.toBe(false);
  });
});
