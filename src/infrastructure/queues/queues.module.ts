import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { redisConfig, type RedisConfig } from '../../config/index.js';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './queue.constants.js';

const queues = Object.values(QUEUE_NAMES).map((name) => ({ name }));

/**
 * BullMQ connection + registration of every queue.
 * Global so any module can `@InjectQueue(QUEUE_NAMES.X)` to enqueue work.
 * Processors (workers) are registered by their owning modules, never by controllers.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (config: RedisConfig) => ({
        prefix: config.queuePrefix,
        connection: {
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db,
        },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue(...queues),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
