import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../infrastructure/queues/queue.constants.js';
import type { QuestionGenerationJobData } from './interfaces/question-generation.interfaces.js';

/**
 * Queues AI question generation from indexed textbook chapters.
 * Generated questions go to content review before reaching the question bank.
 */
@Injectable()
export class QuestionGenerationService {
  constructor(
    @InjectQueue(QUEUE_NAMES.QUESTION_GENERATION)
    private readonly queue: Queue<QuestionGenerationJobData>,
  ) {}

  async requestGeneration(data: QuestionGenerationJobData): Promise<{ jobId: string }> {
    const jobId = `generate:${randomUUID()}`;
    await this.queue.add('generate-questions', data, { jobId });
    return { jobId };
  }
}
