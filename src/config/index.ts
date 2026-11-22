import { appConfig } from './app.config.js';
import { databaseConfig } from './database.config.js';
import { integrationsConfig, storageConfig } from './integrations.config.js';
import { jwtConfig } from './jwt.config.js';
import { redisConfig } from './redis.config.js';

export { envSchema, type Env } from './configuration.js';
export { appConfig, type AppConfig } from './app.config.js';
export { databaseConfig, type DatabaseConfig } from './database.config.js';
export { redisConfig, type RedisConfig } from './redis.config.js';
export { jwtConfig, type JwtConfig } from './jwt.config.js';
export {
  storageConfig,
  integrationsConfig,
  type StorageConfig,
  type IntegrationsConfig,
} from './integrations.config.js';

/** Passed to ConfigModule.forRoot({ load }). */
export const configLoaders = [
  appConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  storageConfig,
  integrationsConfig,
];
