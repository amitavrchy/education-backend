import { hasAnyPermission, type Permission } from '../../common/auth/permissions.js';
import { asText } from '../../common/utils/json.util.js';
import { forbidden, invalid } from '../../common/exceptions/app.exception.js';
import { USER_ROLES } from '../../contracts/user.js';
import type { Entity } from './record-store.service.js';
import type { HookContext, ResourceHooks } from './resource.types.js';

/**
 * Domain invariants enforced on generic writes. Composite operations with real business rules
 * (scoring, XP, billing, content workflow) have dedicated endpoints instead.
 */

const can = (ctx: HookContext, ...perms: Permission[]) =>
  !!ctx.user && hasAnyPermission(ctx.user.permissions, perms);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Rejects a change to any field outside `allowed` (immutable `id` aside). */
export function onlyFields(existing: Entity, next: Entity, allowed: string[]): void {
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === 'id' || key === 'updatedAt' || allowed.includes(key)) continue;
    if (!same(existing[key], next[key])) forbidden(`FIELD_NOT_EDITABLE:${key}`);
  }
}

const PRIVILEGED_ROLES = ['platform_admin', 'super_admin'];

const ROLE_BN: Record<string, string> = {
  student: 'শিক্ষার্থী',
  parent: 'অভিভাবক',
  teacher: 'শিক্ষক',
  content_reviewer: 'কনটেন্ট রিভিউয়ার',
  content_manager: 'কনটেন্ট ম্যানেজার',
  institution_admin: 'প্রতিষ্ঠান অ্যাডমিন',
  support_agent: 'সাপোর্ট',
  finance_admin: 'ফিন্যান্স অ্যাডমিন',
  platform_admin: 'প্ল্যাটফর্ম অ্যাডমিন',
  super_admin: 'সুপার অ্যাডমিন',
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Invitation email: the invitee sets a password through "forgot password" with this address. */
async function sendInvite(data: Entity, ctx: HookContext) {
  const email = String(data.email);
  const name = typeof data.name === 'string' ? data.name : '';
  const role = ROLE_BN[String(data.role)] ?? String(data.role);
  const link = `${ctx.deps.appUrl}/forgot-password?identifier=${encodeURIComponent(email)}`;
  const text = `${name ? `${name}, ` : ''}আপনাকে ShikkhaAI-তে ${role} হিসেবে আমন্ত্রণ জানানো হয়েছে। অ্যাকাউন্ট চালু করতে এই লিংকে গিয়ে আপনার ইমেইলে আসা কোড দিয়ে পাসওয়ার্ড সেট করুন: ${link}`;
  const html = `<div style="font-family:sans-serif;line-height:1.6"><p>${esc(name ? `${name},` : 'স্বাগতম,')}</p><p>আপনাকে <strong>ShikkhaAI</strong>-তে <strong>${esc(role)}</strong> হিসেবে আমন্ত্রণ জানানো হয়েছে।</p><p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none">অ্যাকাউন্ট চালু করুন</a></p><p style="color:#666;font-size:13px">লিংকে গিয়ে আপনার ইমেইলে আসা কোড দিয়ে পাসওয়ার্ড সেট করুন। আমন্ত্রণটি আপনার না হলে এই ইমেইল উপেক্ষা করুন।</p></div>`;
  const sent = await ctx.deps.sendEmail({ to: email, subject: 'ShikkhaAI-তে আমন্ত্রণ', text, html });
  if (sent) data.invitedAt = new Date().toISOString();
}

export const usersHooks: ResourceHooks = {
  beforeCreate(data) {
    if (typeof data.email !== 'string' || !data.email.includes('@'))
      invalid('VALIDATION', { email: ['EMAIL_REQUIRED'] });
    if (!USER_ROLES.includes(data.role as never)) invalid('VALIDATION', { role: ['ROLE_INVALID'] });
    return {
      status: 'invited',
      guardianIds: [],
      studentIds: [],
      planCode: 'free',
      supportTickets: [],
      onboarded: data.role !== 'student',
      ...data,
      email: data.email.trim().toLowerCase(),
    };
  },
  beforeUpdate(existing, next, ctx) {
    const isSelf = ctx.user?.id === existing.id;
    if (!can(ctx, 'users.manage', 'users.support')) {
      if (!isSelf) forbidden();
      onlyFields(existing, next, ['name', 'avatarUrl', 'onboarded', 'lastActiveAt', 'preferences']);
    } else if (!can(ctx, 'users.manage')) {
      // Support agents handle tickets/status, not roles.
      onlyFields(existing, next, ['status', 'supportTickets', 'lastActiveAt', 'notes']);
    }
    if (existing.role !== next.role) {
      if (!USER_ROLES.includes(next.role as never))
        invalid('VALIDATION', { role: ['ROLE_INVALID'] });
      if (
        (PRIVILEGED_ROLES.includes(String(next.role)) ||
          PRIVILEGED_ROLES.includes(String(existing.role))) &&
        !can(ctx, 'roles.manage')
      )
        forbidden();
    }
    if (typeof next.email === 'string') next.email = next.email.trim().toLowerCase();
    return next;
  },
  async afterCreate(data, ctx) {
    await ctx.deps.syncCredentials(data);
    if (data.status === 'invited' && typeof data.email === 'string') await sendInvite(data, ctx);
  },
  async afterUpdate(next, existing, ctx) {
    await ctx.deps.syncCredentials(next, existing);
    if (next.status !== existing.status && next.status !== 'active')
      await ctx.deps.revokeUserSessions(next.id);
  },
  beforeRemove(existing, ctx) {
    if (existing.id === ctx.user?.id) invalid('CANNOT_DELETE_SELF');
  },
  async afterRemove(existing, ctx) {
    await ctx.deps.deleteCredentials(existing.id);
  },
};

const AUTHOR_STATUSES = ['draft', 'submitted'];

/** Authors (teachers) may only draft/submit; publishing goes through the review workflow. */
export const questionsHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    if (!can(ctx, 'questions.manage') && !AUTHOR_STATUSES.includes(asText(data.status, 'draft')))
      forbidden();
    return { status: 'draft', version: 1, ...data };
  },
  beforeUpdate(existing, next, ctx) {
    if (
      !can(ctx, 'questions.manage') &&
      existing.status !== next.status &&
      !AUTHOR_STATUSES.includes(String(next.status))
    )
      forbidden();
    return next;
  },
};

export const contentReportsHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    if (can(ctx, 'moderation.handle', 'content.review', 'questions.manage'))
      return { status: 'open', ...data };
    return { ...data, reporterId: ctx.user!.id, status: 'open' };
  },
};

/** Users create notifications only for themselves (reminders); fan-out is server-side. */
export const notificationsHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    const base = { read: false, archived: false, priority: 'normal', ...data };
    if (can(ctx, 'notifications.manage') && typeof data.userId === 'string') return base;
    return { ...base, userId: ctx.user!.id };
  },
  beforeUpdate(existing, next) {
    onlyFields(existing, next, ['read', 'archived']);
    return next;
  },
};

/**
 * Guardian links: the guardian may turn sharing OFF or unlink; turning AI-conversation sharing
 * ON needs the student. Activation happens only through the OTP confirm endpoint.
 */
export const guardianLinksHooks: ResourceHooks = {
  beforeUpdate(existing, next, ctx) {
    onlyFields(existing, next, ['permissions', 'status', 'relation']);
    const isStudent = ctx.user?.id === existing.studentId;
    if (next.status !== existing.status && next.status !== 'revoked') invalid('INVALID_TRANSITION');
    if (!isStudent) {
      const before = (existing.permissions ?? {}) as Record<string, boolean>;
      const after = (next.permissions ?? {}) as Record<string, boolean>;
      if (after.aiConversations && !before.aiConversations) invalid('STUDENT_CONSENT_REQUIRED');
    }
    return next;
  },
};

export const teacherFeedbackHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    return { acknowledged: false, at: new Date().toISOString(), teacherId: ctx.user!.id, ...data };
  },
  // Guardians who may see teacher feedback get it in their inbox.
  async afterCreate(data, ctx) {
    const guardians = await ctx.deps.guardiansOf(asText(data.studentId), 'teacherFeedback');
    await ctx.deps.notify(guardians, {
      type: 'teacher_feedback',
      title: `শিক্ষকের মন্তব্য: ${asText(data.teacherName)}`,
      body: asText(data.text).slice(0, 120),
      href: '/parent/feedback',
    });
  },
  beforeUpdate(existing, next, ctx) {
    if (!can(ctx, 'teacher.dashboard')) onlyFields(existing, next, ['acknowledged']);
    return next;
  },
};

/** Teachers create exams for their own institution; platform exam managers create any. */
export const examsHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    if (can(ctx, 'exams.manage')) return data;
    return {
      ...data,
      institutionId: ctx.user!.institutionId ?? undefined,
      createdBy: { ...(data.createdBy as object), id: ctx.user!.id, role: ctx.user!.role },
    };
  },
  beforeUpdate(existing, next, ctx) {
    if (can(ctx, 'exams.manage')) return next;
    return { ...next, institutionId: existing.institutionId, createdBy: existing.createdBy };
  },
};

export const institutionPapersHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    if (can(ctx, 'institutionPapers.moderate')) return data;
    return { ...data, institutionId: ctx.user!.institutionId, provenance: 'institution_uploaded' };
  },
  beforeUpdate(existing, next, ctx) {
    if (!can(ctx, 'institutionPapers.moderate')) next.institutionId = existing.institutionId;
    return next;
  },
};

/** Tenant-owned rows created by institution staff are pinned to their institution. */
export const tenantHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    if (can(ctx, 'users.manage')) return data;
    if (!ctx.user?.institutionId) forbidden();
    return { ...data, institutionId: ctx.user.institutionId };
  },
  beforeUpdate(existing, next, ctx) {
    if (!can(ctx, 'users.manage')) next.institutionId = existing.institutionId;
    return next;
  },
};

export const assignmentsHooks: ResourceHooks = {
  async beforeCreate(data, ctx) {
    const pinned: Entity = await tenantHooks.beforeCreate!.call(tenantHooks, data, ctx);
    if (can(ctx, 'users.manage')) return pinned;
    return { ...pinned, teacherId: ctx.user!.id };
  },
  beforeUpdate: (existing, next, ctx) =>
    tenantHooks.beforeUpdate!.call(tenantHooks, existing, next, ctx),
};

const SUBMISSION_STUDENT_FIELDS = [
  'answer',
  'text',
  'files',
  'attachments',
  'status',
  'submittedAt',
  'content',
  'fileNames',
];

async function assignmentTitle(ctx: HookContext, assignmentId: unknown) {
  const a = await ctx.deps.find('assignments', String(assignmentId));
  return asText(a?.title);
}

export const submissionsHooks: ResourceHooks = {
  // A teacher distributing an assignment creates the student's pending submission.
  async afterCreate(data, ctx) {
    if (!can(ctx, 'submission.review') || data.status !== 'pending') return;
    const a = await ctx.deps.find('assignments', asText(data.assignmentId));
    await ctx.deps.notify([asText(data.studentId)], {
      type: 'new_assignment',
      title: `নতুন অ্যাসাইনমেন্ট: ${asText(a?.title)}`,
      body: a?.dueAt
        ? `জমার শেষ সময়: ${new Date(asText(a.dueAt)).toLocaleDateString('bn-BD')}`
        : '',
      href: '/student/study-planner',
    });
  },
  async afterUpdate(next, existing, ctx) {
    if (!can(ctx, 'submission.review') || next.status === existing.status) return;
    if (next.status !== 'graded' && next.status !== 'returned') return;
    const title = await assignmentTitle(ctx, next.assignmentId);
    await ctx.deps.notify([asText(next.studentId)], {
      type: 'teacher_feedback',
      title:
        next.status === 'graded' ? `অ্যাসাইনমেন্টের নম্বর: ${title}` : `অ্যাসাইনমেন্ট ফেরত: ${title}`,
      body:
        next.status === 'graded'
          ? `${asText(next.marks)} নম্বর · ${asText(next.feedback).slice(0, 60)}`
          : asText(next.feedback).slice(0, 100),
      href: '/student/notifications',
    });
  },
  beforeCreate(data, ctx) {
    if (can(ctx, 'submission.review')) return data;
    return {
      ...data,
      studentId: ctx.user!.id,
      status: data.status === 'pending' ? 'pending' : 'submitted',
    };
  },
  beforeUpdate(existing, next, ctx) {
    if (!can(ctx, 'submission.review')) {
      onlyFields(existing, next, SUBMISSION_STUDENT_FIELDS);
      if (!['pending', 'submitted', 'late'].includes(asText(next.status))) forbidden();
    }
    return next;
  },
};

export const privacyRequestsHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    if (can(ctx, 'users.support', 'users.manage')) return data;
    const due = new Date(Date.now() + 30 * 864e5).toISOString();
    return { dueAt: due, ...data, userId: ctx.user!.id, status: 'received' };
  },
};

export const ingestionJobsHooks: ResourceHooks = {
  async afterCreate(data, ctx) {
    await ctx.deps.startIngestion(data.id);
  },
};

/** Students only author their own (user) messages; assistant replies come from the tutor endpoint. */
export const messagesHooks: ResourceHooks = {
  beforeCreate(data) {
    if (data.role !== 'user') forbidden('ASSISTANT_MESSAGES_ARE_SERVER_GENERATED');
    return data;
  },
  beforeUpdate(existing, next) {
    if (existing.role === 'assistant') {
      onlyFields(existing, next, [
        'feedback',
        'reported',
        'teacherReviewRequested',
        'bookmarked',
        'pinned',
      ]);
    }
    return next;
  },
};

/** Teachers/reviewers add the review stage to handwriting evaluations; students edit drafts. */
export const evaluationsHooks: ResourceHooks = {
  beforeUpdate(existing, next, ctx) {
    // Students can't promote their own work to a teacher-reviewed or official grade.
    const promoted =
      existing.stage !== next.stage &&
      ['teacher_reviewed', 'official'].includes(asText(next.stage));
    if (promoted && !can(ctx, 'evaluation.review')) forbidden();
    return next;
  },
  async afterUpdate(next, existing, ctx) {
    if (
      next.stage === existing.stage ||
      !['teacher_reviewed', 'official'].includes(asText(next.stage))
    )
      return;
    await ctx.deps.notify([ctx.scope], {
      type: 'teacher_feedback',
      title: `খাতা মূল্যায়ন সম্পন্ন: ${asText(next.title)}`,
      body: `শিক্ষকের নম্বর: ${asText(next.teacherMarks ?? next.officialMarks)}/${asText(next.maxMarks)}`,
      href: '/student/answer-evaluation',
    });
  },
};

export const apiKeysHooks: ResourceHooks = {
  beforeCreate(data) {
    // Secrets never live in this store: keep only a masked placeholder.
    return { ...data, maskedValue: maskSecret(asText(data.maskedValue)) };
  },
  beforeUpdate(_existing, next) {
    return { ...next, maskedValue: maskSecret(asText(next.maskedValue)) };
  },
};

export function maskSecret(value: string): string {
  if (/^[•*]+.{0,4}$/.test(value) || value.includes('••••')) return value;
  const tail = value.slice(-4);
  return `••••••••${tail}`;
}

export const auditLogsHooks: ResourceHooks = {
  beforeCreate(data, ctx) {
    return {
      ...data,
      at: new Date().toISOString(),
      actor: {
        id: ctx.user!.id,
        name: String((data.actor as { name?: string })?.name ?? ctx.user!.id),
        role: ctx.user!.role,
      },
      ip: 'client',
    };
  },
};
