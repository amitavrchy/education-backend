/** Injection token for the shared ioredis client (cache, locks, rate-limit storage). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
