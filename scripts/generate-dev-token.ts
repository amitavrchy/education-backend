/**
 * Development helper: signs a 1-hour access token, to try protected endpoints with curl.
 * Refuses to run with NODE_ENV=production. Prefer the real login (POST /auth/login).
 *
 *   npm run dev:token -- super_admin u-sadmin-1
 *   npm run dev:token -- student u-student-1 inst-1
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { JwtAccessPayload } from '../src/common/interfaces/authenticated-user.interface.js';
import { envSchema } from '../src/config/configuration.js';
import { USER_ROLES, type UserRole } from '../src/contracts/user.js';

const env = envSchema.parse(process.env);
if (env.NODE_ENV === 'production') {
  console.error('Refusing to mint tokens in production.');
  process.exit(1);
}

const role = (process.argv[2] ?? 'student') as UserRole;
if (!USER_ROLES.includes(role)) {
  console.error(`Unknown role "${role}". Use one of: ${USER_ROLES.join(', ')}`);
  process.exit(1);
}
const userId = process.argv[3] ?? randomUUID();
const payload: JwtAccessPayload = { sub: userId, role, institutionId: process.argv[4] ?? null };

const token = await new JwtService().signAsync(payload, {
  secret: env.JWT_ACCESS_SECRET,
  expiresIn: '1h',
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
});

console.log(`Role: ${role}\nUser: ${userId}\n\nAuthorization: Bearer ${token}`);
