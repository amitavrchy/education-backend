import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../infrastructure/queues/queue.constants.js';
import type { PdfProcessingJobData } from './interfaces/document-pipeline.interfaces.js';

/** Entry point of the document pipeline: marks the file QUEUED and enqueues processing. */
@Injectable()
export class DocumentProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.PDF_PROCESSING) private readonly queue: Queue<PdfProcessingJobData>,
  ) {}

  async enqueuePdf(data: PdfProcessingJobData): Promise<void> {
    await this.prisma.storedFile.update({
      where: { id: data.fileId },
      data: { processingStatus: 'QUEUED', processingError: null },
    });
    await this.queue.add('process-pdf', data, { jobId: `pdf:${data.fileId}` });
  }
}
