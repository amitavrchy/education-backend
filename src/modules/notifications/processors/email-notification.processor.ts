import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../../infrastructure/queues/queue.constants.js';
import { ToggleableWorkerHost } from '../../../infrastructure/queues/toggleable-worker.host.js';
import {
  EMAIL_PROVIDER,
  type EmailMessage,
  type EmailProvider,
} from '../../../integrations/email/email.module.js';

/** Delivers queued emails through the configured EmailProvider (console in development). */
@Processor(QUEUE_NAMES.EMAIL_NOTIFICATIONS, { autorun: false, concurrency: 5 })
export class EmailNotificationProcessor extends ToggleableWorkerHost {
  constructor(@Inject(EMAIL_PROVIDER) private readonly email: EmailProvider) {
    super();
  }

  async process(job: Job<EmailMessage>): Promise<void> {
    await this.email.send(job.data);
  }
}
