import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../infrastructure/queues/queue.constants.js';
import type { AnswerEvaluationJobData } from './interfaces/answer-evaluation.interfaces.js';

/** Queues AI evaluation of written answers. The evaluator itself is not implemented yet. */
@Injectable()
export class AnswerEvaluationService {
  constructor(
    @InjectQueue(QUEUE_NAMES.AI_ANSWER_EVALUATION)
    private readonly queue: Queue<AnswerEvaluationJobData>,
  ) {}

  /** Idempotent: the same answer is never queued twice. */
  async requestEvaluation(data: AnswerEvaluationJobData): Promise<void> {
    await this.queue.add('evaluate-answer', data, { jobId: `evaluate:${data.answerId}` });
  }
}
