import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { dateKey } from '../../common/utils/dates.js';
import type { SessionRecord } from '../../contracts/operations.js';
import type { UserRole } from '../../contracts/user.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';

function device(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Other';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'App';
  return `${browser} · ${os}`;
}

type CountRow = { day: string; n: bigint | number | null };

/** Platform operations: live sessions and analytics computed from real data. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async sessions(caller: AuthenticatedUser): Promise<SessionRecord[]> {
    const rows = await this.prisma.userSession.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { name: true, role: true } } },
      orderBy: { lastUsedAt: 'desc' },
      take: 500,
    });
    return rows.map((s) => ({
      id: s.id,
      userId: s.userId,
      userName: s.user.name,
      role: s.user.role as UserRole,
      device: device(s.userAgent),
      location: s.ipAddress ?? '—',
      startedAt: s.createdAt.toISOString(),
      lastSeenAt: (s.lastUsedAt ?? s.createdAt).toISOString(),
      current: s.id === caller.sessionId,
    }));
  }

  async revokeSession(caller: AuthenticatedUser, id: string) {
    const s = await this.prisma.userSession.findFirst({
      where: { id, revokedAt: null },
      include: { user: { select: { name: true } } },
    });
    if (!s) notFound('Session');
    await this.prisma.userSession.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({
      actor: caller,
      category: 'security',
      action: 'session.revoke',
      target: { type: 'Session', id, label: s.user.name },
    });
  }

  /** Daily platform series (admin analytics), from users, activity, messages, payments, reports. */
  async series(days: number) {
    const from = new Date(Date.now() - (days - 1) * 864e5);
    const fromKey = dateKey(-(days - 1));
    const q = (sql: Promise<CountRow[]>) =>
      sql.then((rows) => new Map(rows.map((r) => [r.day, Number(r.n ?? 0)])));
    const [dau, signups, paid, revenue, ai, voice, study, reports] = await Promise.all([
      q(
        this.prisma.$queryRaw<
          CountRow[]
        >`SELECT data->>'date' AS day, count(DISTINCT scope) AS n FROM records WHERE collection = 'activity' AND data->>'date' >= ${fromKey} GROUP BY 1`,
      ),
      q(
        this.prisma.$queryRaw<
          CountRow[]
        >`SELECT to_char(created_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day, count(*) AS n FROM users WHERE created_at >= ${from} GROUP BY 1`,
      ),
      q(
        this.prisma.$queryRaw<
          CountRow[]
        >`SELECT left(data->>'createdAt', 10) AS day, count(*) AS n FROM records WHERE collection = 'payments' AND data->>'status' = 'success' AND (data->>'amount')::numeric > 0 AND data->>'createdAt' >= ${fromKey} GROUP BY 1`,
      ),
      q(
        this.prisma.$queryRaw<
          CountRow[]
        >`SELECT left(data->>'createdAt', 10) AS day, sum((data->>'amount')::numeric) AS n FROM records WHERE collection = 'payments' AND data->>'status' = 'success' AND data->>'createdAt' >= ${fromKey} GROUP BY 1`,
      ),
      q(
        this.prisma.$queryRaw<
          CountRow[]
        >`SELECT left(data->>'createdAt', 10) AS day, count(*) AS n FROM records WHERE collection = 'messages' AND data->>'role' = 'user' AND data->>'createdAt' >= ${fromKey} GROUP BY 1`,
      ),
      q(
        this.prisma.$queryRaw<
          CountRow[]
        >`SELECT data->>'date' AS day, sum((data->>'minutes')::numeric) AS n FROM records WHERE collection = 'activity' AND data->>'kind' = 'voice' AND data->>'date' >= ${fromKey} GROUP BY 1`,
      ),
      q(
        this.prisma.$queryRaw<
          CountRow[]
        >`SELECT day, avg(total) AS n FROM (SELECT data->>'date' AS day, scope, sum((data->>'minutes')::numeric) AS total FROM records WHERE collection = 'activity' AND data->>'date' >= ${fromKey} GROUP BY 1, 2) t GROUP BY 1`,
      ),
      q(
        this.prisma.$queryRaw<
          CountRow[]
        >`SELECT left(data->>'createdAt', 10) AS day, count(*) AS n FROM records WHERE collection IN ('contentReports', 'moderationCases') AND data->>'createdAt' >= ${fromKey} GROUP BY 1`,
      ),
    ]);
    return Array.from({ length: days }, (_, i) => {
      const date = dateKey(i - (days - 1));
      return {
        date,
        dau: dau.get(date) ?? 0,
        signups: signups.get(date) ?? 0,
        paid: paid.get(date) ?? 0,
        aiRequests: ai.get(date) ?? 0,
        voiceMinutes: Math.round(voice.get(date) ?? 0),
        revenue: Math.round(revenue.get(date) ?? 0),
        studyMinutes: Math.round(study.get(date) ?? 0),
        reports: reports.get(date) ?? 0,
      };
    });
  }

  /**
   * Analytics breakdowns from real data: active users, revenue by plan, churn, AI usage, weekly
   * retention cohorts (sign-up week → weeks still active) and per-subject engagement.
   */
  async breakdowns(days: number) {
    const fromKey = dateKey(-(days - 1));
    const n = (v: unknown) => Number(v ?? 0);
    const [mau, byPlan, churn, aiTokens, cohorts, subjects] = await Promise.all([
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT scope) AS n FROM records
        WHERE collection = 'activity' AND data->>'date' >= ${dateKey(-29)}`,
      this.prisma.$queryRaw<{ plan: string; n: number }[]>`SELECT coalesce(data->>'planCode', 'other') AS plan,
        sum((data->>'amount')::numeric)::float AS n FROM records WHERE collection = 'payments'
        AND data->>'status' = 'success' AND data->>'createdAt' >= ${fromKey} GROUP BY 1 ORDER BY 2 DESC`,
      this.prisma.$queryRaw<{ status: string; n: bigint }[]>`SELECT data->>'status' AS status, count(*) AS n
        FROM records WHERE collection = 'subscriptions' GROUP BY 1`,
      this.prisma.$queryRaw<{ n: number }[]>`SELECT coalesce(sum((data->>'tokens')::numeric), 0)::float AS n
        FROM records WHERE collection = 'aiLogs' AND data->>'at' >= ${fromKey}`,
      // First activity week per student → share active in each following week.
      this.prisma.$queryRaw<{ cohort: string; week: number; n: bigint; size: bigint }[]>`
        WITH act AS (
          SELECT scope, date_trunc('week', (data->>'date')::date) AS wk FROM records
          WHERE collection = 'activity' AND data->>'date' >= ${dateKey(-7 * 8)} GROUP BY 1, 2
        ), first AS (SELECT scope, min(wk) AS cohort FROM act GROUP BY 1),
        sizes AS (SELECT cohort, count(*) AS size FROM first GROUP BY 1)
        SELECT to_char(f.cohort, 'YYYY-MM-DD') AS cohort,
          (EXTRACT(EPOCH FROM (a.wk - f.cohort)) / 604800)::int AS week, count(*) AS n, s.size
        FROM act a JOIN first f USING (scope) JOIN sizes s ON s.cohort = f.cohort
        GROUP BY f.cohort, week, s.size ORDER BY f.cohort, week`,
      this.prisma.$queryRaw<{ subject: string; attempts: bigint; correct: bigint }[]>`
        SELECT data->>'subjectId' AS subject, count(*) AS attempts,
          count(*) FILTER (WHERE (data->>'correct')::boolean) AS correct
        FROM records WHERE collection = 'attempts' AND left(data->>'answeredAt', 10) >= ${fromKey}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    ]);
    const completion = await this.prisma.$queryRaw<{ subject: string; pct: number }[]>`
      SELECT data->>'subjectId' AS subject, avg((data->>'percent')::numeric)::float AS pct
      FROM records WHERE collection = 'chapterProgress' GROUP BY 1`;
    const pct = new Map(completion.map((c) => [c.subject, c.pct]));
    const subs = new Map(churn.map((c) => [c.status, n(c.n)]));
    const live = (subs.get('active') ?? 0) + (subs.get('trialing') ?? 0) + (subs.get('past_due') ?? 0);
    const lost = (subs.get('cancelled') ?? 0) + (subs.get('expired') ?? 0);
    const totalAttempts = subjects.reduce((sum, x) => sum + n(x.attempts), 0) || 1;
    const byCohort = new Map<string, { cohort: string; size: number; weeks: number[] }>();
    for (const row of cohorts) {
      const c = byCohort.get(row.cohort) ?? { cohort: row.cohort, size: n(row.size), weeks: [] };
      if (row.week >= 0 && row.week < 6) c.weeks[row.week] = Math.round((n(row.n) / Math.max(1, n(row.size))) * 100);
      byCohort.set(row.cohort, c);
    }
    return {
      mau: n(mau[0]?.n),
      revenueByPlan: byPlan.map((p) => ({ plan: p.plan, amount: Math.round(p.n) })),
      churnPercent: live + lost ? Math.round((lost / (live + lost)) * 1000) / 10 : 0,
      aiTokens: Math.round(n(aiTokens[0]?.n)),
      cohorts: [...byCohort.values()].slice(-6).map((c) => ({ ...c, weeks: Array.from({ length: 6 }, (_, i) => c.weeks[i] ?? null) })),
      subjects: subjects.map((x) => ({
        subjectId: x.subject,
        popularity: Math.round((n(x.attempts) / totalAttempts) * 100),
        completion: Math.round(pct.get(x.subject) ?? 0),
        score: Math.round((n(x.correct) / Math.max(1, n(x.attempts))) * 100),
      })),
    };
  }

  /** Headline numbers for the admin overview. */
  async overview() {
    const count = (collection: string, where = '') =>
      this.prisma
        .$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM records WHERE collection = $1 ${where}`,
          collection,
        )
        .then((r) => Number(r[0]?.n ?? 0));
    const [
      byRole,
      questions,
      pendingReview,
      openModeration,
      activeSubs,
      runningIngestion,
      openReports,
    ] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      count('questions', `AND data->>'status' = 'published'`),
      count('reviewItems', `AND data->>'status' IN ('submitted', 'in_review')`),
      count('moderationCases', `AND data->>'status' IN ('open', 'in_review')`),
      count('subscriptions', `AND data->>'status' IN ('active', 'trialing')`),
      count('ingestionJobs', `AND data->>'stageStatus' IN ('running', 'waiting_review')`),
      count('contentReports', `AND data->>'status' IN ('open', 'in_review')`),
    ]);
    return {
      usersByRole: Object.fromEntries(byRole.map((r) => [r.role, r._count._all])),
      publishedQuestions: questions,
      pendingReview,
      openModeration,
      activeSubscriptions: activeSubs,
      runningIngestion,
      openReports,
    };
  }
}
