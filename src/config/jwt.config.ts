import { registerAs } from '@nestjs/config';
import { envSchema } from './configuration.js';

export const jwtConfig = registerAs('jwt', () => {
  const env = envSchema.parse(process.env);
  return {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    sessionTtlHours: env.SESSION_TTL_HOURS,
  };
});

export type JwtConfig = ReturnType<typeof jwtConfig>;
