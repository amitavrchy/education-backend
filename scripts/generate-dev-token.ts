/**
 * Development helper: signs an access token for a role, to try protected endpoints
 * before the login flow exists. Refuses to run with NODE_ENV=production.
 *
 *   npm run dev:token -- SUPER_ADMIN
 *   npm run dev:token -- STUDENT <userId>
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/common/constants/role-permissions.js';
import { RoleKey } from '../src/common/enums/role.enum.js';
import { envSchema } from '../src/config/configuration.js';

const env = envSchema.parse(process.env);
if (env.NODE_ENV === 'production') {
  console.error('Refusing to mint tokens in production.');
  process.exit(1);
}

const role = (process.argv[2] ?? 'STUDENT') as RoleKey;
if (!Object.values(RoleKey).includes(role)) {
  console.error(`Unknown role "${role}". Use one of: ${Object.values(RoleKey).join(', ')}`);
  process.exit(1);
}
const userId = process.argv[3] ?? randomUUID();

const token = await new JwtService().signAsync(
  {
    sub: userId,
    roles: [role],
    permissions: [...DEFAULT_ROLE_PERMISSIONS[role]],
    institutionId: null,
  },
  {
    secret: env.JWT_ACCESS_SECRET,
    expiresIn: '1h',
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  },
);

console.log(`Role: ${role}\nUser: ${userId}\n\nAuthorization: Bearer ${token}`);
