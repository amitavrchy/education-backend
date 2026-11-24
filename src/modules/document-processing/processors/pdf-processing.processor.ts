import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../../infrastructure/queues/queue.constants.js';
import { ToggleableWorkerHost } from '../../../infrastructure/queues/toggleable-worker.host.js';
import { IngestionService, type IngestionStepJob } from '../ingestion.service.js';

/** Worker for the pdf-processing queue: advances ingestion jobs one stage at a time. */
@Processor(QUEUE_NAMES.PDF_PROCESSING, { autorun: false, concurrency: 2 })
export class PdfProcessingProcessor extends ToggleableWorkerHost {
  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<IngestionStepJob>): Promise<void> {
    if (job.name === 'ingestion-step') await this.ingestion.step(job.data.jobId);
    else this.logger.warn({ jobId: job.id, name: job.name }, 'Unknown pdf-processing job; skipped');
  }
}
