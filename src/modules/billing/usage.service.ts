import { Injectable } from '@nestjs/common';
import { invalid } from '../../common/exceptions/app.exception.js';
import { dateKey } from '../../common/utils/dates.js';
import type { Plan, PlanCode, PlanLimits, UsageMeter } from '../../contracts/operations.js';
import type { UserAccount } from '../../contracts/people.js';
import { DocumentsService } from '../records/documents.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

export const PLAN_LIMITS: Record<PlanCode, PlanLimits> = {
  free: {
    aiMessagesPerDay: 20,
    voiceMinutesPerMonth: 15,
    photoSolvesPerDay: 5,
    offlineDownloads: 3,
    members: 1,
    handwritingEvaluationsPerMonth: 3,
  },
  pro: {
    aiMessagesPerDay: 300,
    voiceMinutesPerMonth: 300,
    photoSolvesPerDay: 60,
    offlineDownloads: 50,
    members: 1,
    handwritingEvaluationsPerMonth: 40,
  },
  family: {
    aiMessagesPerDay: 300,
    voiceMinutesPerMonth: 300,
    photoSolvesPerDay: 60,
    offlineDownloads: 50,
    members: 4,
    handwritingEvaluationsPerMonth: 40,
  },
};

export type UsageKind = 'ai' | 'voice' | 'photo' | 'handwriting';

const FIELDS = {
  ai: ['aiMessagesToday', 'aiMessagesPerDay'],
  voice: ['voiceMinutesThisMonth', 'voiceMinutesPerMonth'],
  photo: ['photoSolvesToday', 'photoSolvesPerDay'],
  handwriting: ['handwritingThisMonth', 'handwritingEvaluationsPerMonth'],
} as const;

const key = (userId: string) => `usage:${userId}`;

/** Plan entitlements and quota meters (frontend usageService), enforced server-side. */
@Injectable()
export class UsageService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly store: RecordStoreService,
  ) {}

  private async meter(userId: string): Promise<UsageMeter> {
    const today = dateKey(0);
    const doc = await this.documents.get<UsageMeter>(
      key(userId),
      () => ({
        id: userId,
        aiMessagesToday: 0,
        voiceMinutesThisMonth: 0,
        photoSolvesToday: 0,
        handwritingThisMonth: 0,
        date: today,
      }),
      userId,
    );
    if (doc.date === today) return doc;
    const sameMonth = doc.date.slice(0, 7) === today.slice(0, 7);
    return {
      ...doc,
      aiMessagesToday: 0,
      photoSolvesToday: 0,
      voiceMinutesThisMonth: sameMonth ? doc.voiceMinutesThisMonth : 0,
      handwritingThisMonth: sameMonth ? doc.handwritingThisMonth : 0,
      date: today,
    };
  }

  async get(userId: string) {
    const meter = await this.meter(userId);
    const account = await this.store.find<UserAccount & Entity>(
      { collection: 'users', scope: '' },
      userId,
    );
    const plan = (account?.planCode ?? 'free') as PlanCode;
    const [planRecord] = await this.store.all<Plan & Entity>({ collection: 'plans', scope: '' }, [
      { code: [plan] },
    ]);
    return { meter, plan, limits: planRecord?.limits ?? PLAN_LIMITS[plan] ?? PLAN_LIMITS.free };
  }

  /** Throws QUOTA_EXCEEDED (429) when the plan limit is reached; otherwise increments. */
  async consume(userId: string, kind: UsageKind, amount = 1): Promise<UsageMeter> {
    const { meter, limits } = await this.get(userId);
    const [field, limit] = FIELDS[kind];
    if (meter[field] + amount > limits[limit]) invalid('QUOTA_EXCEEDED', undefined, 429);
    const next = { ...meter, [field]: meter[field] + amount };
    await this.documents.set(key(userId), next, userId);
    return next;
  }
}
