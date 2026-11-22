import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { Public, RawResponse } from '../common/decorators/index.js';
import { PrismaService } from '../database/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../infrastructure/redis/redis.constants.js';

@ApiTags('health')
@Public()
@SkipThrottle()
@RawResponse()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up. Never touches dependencies. */
  @Get()
  @ApiOkResponse({ description: 'Process is alive' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: PostgreSQL and Redis answer. 503 when one is down. */
  @Get('ready')
  @HealthCheck()
  @ApiServiceUnavailableResponse({ description: 'A dependency is unavailable' })
  ready() {
    return this.health.check([
      () =>
        this.indicators
          .check('database')
          .attempt(async () => {
            await this.prisma.isHealthy();
          })
          .withTimeout('2s'),
      () =>
        this.indicators
          .check('redis')
          .attempt(async () => {
            await this.redis.ping();
          })
          .withTimeout('2s'),
    ]);
  }
}
