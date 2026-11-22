import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

const KEY_LENGTH = 64;
// N=2^15, r=8, p=1 (~32 MB, OWASP-recommended minimum for scrypt).
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Password hashing with Node's built-in scrypt (no native addon).
 * Format: scrypt$N$r$p$<salt b64>$<hash b64> — parameters are stored, so they can be raised later.
 */
@Injectable()
export class PasswordHasherService {
  /** Precomputed hash checked when the user doesn't exist, so timing doesn't reveal accounts. */
  private readonly dummyHash = this.hash('dummy-password-for-timing-safety');

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);
    return [
      'scrypt',
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString('base64'),
      key.toString('base64'),
    ].join('$');
  }

  /** Always does the same amount of work, whether or not `storedHash` exists. */
  async verify(password: string, storedHash: string | null | undefined): Promise<boolean> {
    const target = storedHash ?? (await this.dummyHash);
    const [algorithm, n, r, p, saltB64, hashB64] = target.split('$');
    if (algorithm !== 'scrypt' || !saltB64 || !hashB64) return false;

    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: PARAMS.maxmem,
    });
    return timingSafeEqual(actual, expected) && storedHash != null;
  }
}
