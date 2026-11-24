import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { dateKey, nowIso } from '../../common/utils/dates.js';
import type { ExamAttempt } from '../../contracts/assessment.js';
import type { GuardianLink, TeacherFeedback, UserAccount } from '../../contracts/people.js';
import type { ActivityEntry, StudyTask, TopicMastery } from '../../contracts/study.js';
import { AuthService } from '../auth/auth.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProgressService } from '../progress/progress.service.js';
import { DocumentsService } from '../records/documents.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

const LINKS = { collection: 'guardianLinks', scope: '' };
const USERS = { collection: 'users', scope: '' };
const LINK_OPTS = { ownerField: 'guardianId' };
const CODE_TTL_MS = 7 * 864e5;
const codeKey = (code: string) => `guardianCode:${code}`;

export interface ChildSummary {
  link: GuardianLink;
  minutesWeek: number | null;
  minutesPrevWeek: number | null;
  tasksDone: number | null;
  tasksMissed: number | null;
  avgScore: number | null;
  streak: number | null;
  weakTopicIds: string[];
  subjectMastery: { subjectId: string; mastery: number }[];
}

/**
 * Guardian portal (§27). A guardian sees only what the link's permission flags allow; AI
 * conversations stay private unless the STUDENT enables sharing. Linking: the student shares a
 * code from settings → the guardian enters it → a code is sent to the guardian → link active.
 */
@Injectable()
export class GuardianService {
  constructor(
    private readonly store: RecordStoreService,
    private readonly documents: DocumentsService,
    private readonly auth: AuthService,
    private readonly progress: ProgressService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Student: issue (or reuse) a share code valid for 7 days. */
  async linkCode(studentId: string) {
    const existing = await this.documents.find<{ code: string; expiresAt: string }>(
      `guardianCodeOf:${studentId}`,
    );
    if (existing && new Date(existing.expiresAt).getTime() > Date.now()) return existing;
    const code = `SHK-${String(randomInt(1000, 10000))}`;
    const doc = { code, studentId, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() };
    await this.documents.set(codeKey(code), doc, studentId);
    await this.documents.set(`guardianCodeOf:${studentId}`, doc, studentId);
    return { code, expiresAt: doc.expiresAt };
  }

  async links(guardianId: string) {
    return (
      await this.store.all<GuardianLink & Entity>(LINKS, [{ guardianId: [guardianId] }])
    ).filter((l) => l.status !== 'revoked');
  }

  /** Guardian: enter the student's code → pending link + verification code to the guardian. */
  async requestLink(guardian: AuthenticatedUser, code: string, relation: string) {
    const doc = await this.documents.find<{ studentId: string; expiresAt: string }>(
      codeKey(code.trim().toUpperCase()),
    );
    if (!doc || new Date(doc.expiresAt).getTime() < Date.now()) invalid('LINK_CODE_INVALID');
    const student = await this.store.find<UserAccount & Entity>(USERS, doc.studentId);
    if (!student || student.role !== 'student') invalid('LINK_CODE_INVALID');
    const all = await this.store.all<GuardianLink & Entity>(LINKS, [
      { guardianId: [guardian.id], studentId: [doc.studentId] },
    ]);
    const existing = all[0];
    if (existing?.status === 'active') invalid('ALREADY_LINKED');
    const link: GuardianLink = existing
      ? { ...existing, status: 'pending', relation }
      : {
          id: RecordStoreService.newId('gl'),
          guardianId: guardian.id,
          studentId: doc.studentId,
          studentName: student.name,
          relation,
          status: 'pending',
          permissions: {
            progress: true,
            scores: true,
            studyTime: true,
            calendar: false,
            teacherFeedback: true,
            aiConversations: false,
          },
          code: code.trim().toUpperCase(),
        };
    await this.store.upsert(LINKS, link as GuardianLink & Entity, LINK_OPTS);
    const me = await this.store.find<UserAccount & Entity>(USERS, guardian.id);
    const target = me?.phone || me?.email;
    if (!target) invalid('CONTACT_REQUIRED');
    const pending = await this.auth.sendOtp('guardian_link', target, {
      linkId: link.id,
      guardianId: guardian.id,
    });
    return { link, pending };
  }

  async confirmLink(
    guardian: AuthenticatedUser,
    linkId: string,
    challengeId: string,
    code: string,
  ) {
    const payload = await this.auth.consumeOtp(challengeId, code, 'guardian_link');
    if (payload.linkId !== linkId || payload.guardianId !== guardian.id) invalid('OTP_INVALID');
    const link =
      (await this.store.find<GuardianLink & Entity>(LINKS, linkId)) ?? notFound('GuardianLink');
    const active = { ...link, status: 'active' as const, linkedAt: nowIso() };
    await this.store.replace(LINKS, active, LINK_OPTS);
    await this.syncAccountLinks(link.guardianId, link.studentId, true);
    await this.notifications.push([link.studentId], {
      type: 'system',
      title: 'অভিভাবক যুক্ত হয়েছেন',
      body: 'সেটিংস থেকে কী কী দেখা যাবে তা নিয়ন্ত্রণ করো।',
      href: '/student/settings',
      priority: 'normal',
    });
    return active;
  }

  async unlink(user: AuthenticatedUser, linkId: string) {
    const link = await this.store.find<GuardianLink & Entity>(LINKS, linkId);
    if (!link || (link.guardianId !== user.id && link.studentId !== user.id))
      notFound('GuardianLink');
    const revoked = { ...link, status: 'revoked' as const };
    await this.store.replace(LINKS, revoked, LINK_OPTS);
    await this.syncAccountLinks(link.guardianId, link.studentId, false);
    return revoked;
  }

  private async syncAccountLinks(guardianId: string, studentId: string, add: boolean) {
    const edit = async (id: string, field: 'studentIds' | 'guardianIds', other: string) => {
      const a = await this.store.find<UserAccount & Entity>(USERS, id);
      if (!a) return;
      const list = new Set(a[field] ?? []);
      if (add) list.add(other);
      else list.delete(other);
      await this.store.replace(
        USERS,
        { ...a, [field]: [...list] },
        { institutionField: 'institutionId' },
      );
    };
    await edit(guardianId, 'studentIds', studentId);
    await edit(studentId, 'guardianIds', guardianId);
  }

  /** Per-child dashboard summary; fields the link doesn't allow come back as null/empty. */
  async summaries(guardianId: string): Promise<ChildSummary[]> {
    const links = (await this.links(guardianId)).filter((l) => l.status === 'active');
    return Promise.all(links.map((l) => this.summary(l)));
  }

  private async summary(link: GuardianLink): Promise<ChildSummary> {
    const id = link.studentId;
    const p = link.permissions;
    const wk = dateKey(-6);
    const pwk = dateKey(-13);
    const today = dateKey(0);
    const out: ChildSummary = {
      link,
      minutesWeek: null,
      minutesPrevWeek: null,
      tasksDone: null,
      tasksMissed: null,
      avgScore: null,
      streak: null,
      weakTopicIds: [],
      subjectMastery: [],
    };
    if (p.studyTime) {
      const activity = await this.store.all<ActivityEntry & Entity>({
        collection: 'activity',
        scope: id,
      });
      out.minutesWeek = activity.filter((a) => a.date >= wk).reduce((s, a) => s + a.minutes, 0);
      out.minutesPrevWeek = activity
        .filter((a) => a.date >= pwk && a.date < wk)
        .reduce((s, a) => s + a.minutes, 0);
      out.streak = (await this.progress.gamification(id)).streak.current;
    }
    if (p.calendar) {
      const tasks = await this.store.all<StudyTask & Entity>({ collection: 'tasks', scope: id });
      out.tasksDone = tasks.filter(
        (t) => t.status === 'completed' && t.date >= wk && t.date <= today,
      ).length;
      out.tasksMissed = tasks.filter((t) => t.status === 'missed' && t.date >= wk).length;
    }
    if (p.scores) {
      const done = (
        await this.store.all<ExamAttempt & Entity>({ collection: 'examAttempts', scope: id })
      ).filter((a) => a.result);
      out.avgScore = done.length
        ? Math.round(done.reduce((s, a) => s + a.result!.percent, 0) / done.length)
        : null;
    }
    if (p.progress) {
      const mastery = await this.store.all<TopicMastery & Entity>({
        collection: 'mastery',
        scope: id,
      });
      const bySubject = new Map<string, { s: number; n: number }>();
      for (const m of mastery) {
        const e = bySubject.get(m.subjectId) ?? { s: 0, n: 0 };
        e.s += m.mastery;
        e.n += 1;
        bySubject.set(m.subjectId, e);
      }
      out.weakTopicIds = mastery
        .filter((m) => m.attempts >= 2 && m.mastery < 55)
        .sort((a, b) => a.mastery - b.mastery)
        .slice(0, 5)
        .map((m) => m.topicId);
      out.subjectMastery = [...bySubject.entries()]
        .map(([subjectId, e]) => ({ subjectId, mastery: Math.round(e.s / e.n) }))
        .sort((a, b) => b.mastery - a.mastery);
    }
    return out;
  }

  async replyToTeacher(guardian: AuthenticatedUser, feedbackId: string, message: string) {
    const fb = await this.store.find<TeacherFeedback & Entity>(
      { collection: 'teacherFeedback', scope: '' },
      feedbackId,
    );
    if (!fb) notFound('TeacherFeedback');
    const linked = (await this.links(guardian.id)).some(
      (l) => l.status === 'active' && l.studentId === fb.studentId && l.permissions.teacherFeedback,
    );
    if (!linked) notFound('TeacherFeedback');
    const me = await this.store.find<UserAccount & Entity>(USERS, guardian.id);
    const teacherId = (fb as unknown as { teacherId?: string }).teacherId;
    const note = {
      type: 'teacher_feedback' as const,
      title: `অভিভাবকের বার্তা: ${me?.name ?? ''}`,
      body: message.slice(0, 500),
      href: '/teacher/students',
      priority: 'normal' as const,
    };
    if (teacherId) await this.notifications.push([teacherId], { ...note, portal: 'teacher' });
    else {
      const institutionId = (await this.store.find<UserAccount & Entity>(USERS, fb.studentId))
        ?.institutionId;
      await this.notifications.pushToPortal('teacher', note, { institutionId, roles: ['teacher'] });
    }
    const updated = { ...fb, acknowledged: true };
    await this.store.replace({ collection: 'teacherFeedback', scope: '' }, updated, {
      ownerField: 'studentId',
    });
    return updated;
  }
}
