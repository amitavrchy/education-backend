import { WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { redisConfig, type RedisConfig } from '../../config/index.js';

/**
 * Base class for every BullMQ processor. Declare processors with
 * `@Processor(QUEUE_NAMES.X, { autorun: false })`: the worker starts only when
 * QUEUE_WORKERS_ENABLED=true, so API-only instances and local runs without Redis stay quiet.
 * Later the same code can run in a dedicated worker process.
 */
export abstract class ToggleableWorkerHost extends WorkerHost implements OnApplicationBootstrap {
  protected readonly logger = new Logger(this.constructor.name);

  @Inject(redisConfig.KEY)
  private readonly redisSettings!: RedisConfig;

  onApplicationBootstrap(): void {
    if (!this.redisSettings.workersEnabled) {
      this.logger.log('Queue worker disabled (QUEUE_WORKERS_ENABLED=false)');
      return;
    }
    this.worker.on('failed', (job, error) =>
      this.logger.warn({ jobId: job?.id, err: error.message }, 'Job failed'),
    );
    void this.worker.run();
  }
}
