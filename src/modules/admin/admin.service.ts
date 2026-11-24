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
