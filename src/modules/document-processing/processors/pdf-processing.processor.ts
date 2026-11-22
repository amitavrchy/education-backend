import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../../infrastructure/queues/queue.constants.js';
import { ToggleableWorkerHost } from '../../../infrastructure/queues/toggleable-worker.host.js';
import type { PdfProcessingJobData } from '../interfaces/document-pipeline.interfaces.js';

/**
 * Worker for the pdf-processing queue. Kept apart from controllers and services.
 * The pipeline stages are not implemented yet: the job is acknowledged and logged only,
 * and the file stays in the QUEUED state.
 */
@Processor(QUEUE_NAMES.PDF_PROCESSING, { autorun: false, concurrency: 2 })
export class PdfProcessingProcessor extends ToggleableWorkerHost {
  process(job: Job<PdfProcessingJobData>): Promise<{ status: 'not-implemented' }> {
    this.logger.warn(
      { jobId: job.id, fileId: job.data.fileId },
      'PDF pipeline not implemented; job skipped',
    );
    return Promise.resolve({ status: 'not-implemented' });
  }
}
