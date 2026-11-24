import { Injectable } from '@nestjs/common';
import { asText } from '../../common/utils/json.util.js';
import { forbidden, invalid, notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { nowIso } from '../../common/utils/dates.js';
import { CONTENT_TRANSITIONS, type Actor, type ContentStatus } from '../../contracts/common.js';
import type { ReviewItem } from '../../contracts/operations.js';
import type { Question } from '../../contracts/question.js';
import { allowedTransitions } from '../../domain/content-workflow.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

const ITEMS = { collection: 'reviewItems', scope: '' };
const QUESTIONS = { collection: 'questions', scope: '' };
const REVIEWER_PERMS = ['content.review', 'content.approve', 'content.publish'];

/** Content collections whose `status` follows the review item when it is published/archived. */
const CONTENT_COLLECTION: Partial<Record<ReviewItem['contentType'], string>> = {
  question: 'questions',
  chapter: 'chapters',
  book: 'books',
  rubric: 'rubrics',
  board_paper: 'boardPapers',
};

/**
 * Editorial workflow (master prompt §28): server-enforced state machine with role checks,
 * comments, suggestions and author notifications (frontend reviewService).
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly store: RecordStoreService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  private async actor(user: AuthenticatedUser): Promise<Actor> {
    const account = await this.store.find<Entity>({ collection: 'users', scope: '' }, user.id);
    return { id: user.id, name: asText(account?.name, user.id), role: user.role };
  }

  private async item(user: AuthenticatedUser, id: string): Promise<ReviewItem & Entity> {
    const item = await this.store.find<ReviewItem & Entity>(ITEMS, id);
    const isReviewer = user.permissions.some((p) => REVIEWER_PERMS.includes(p));
    if (!item || (!isReviewer && item.submittedBy.id !== user.id)) notFound('ReviewItem');
    return item;
  }

  async transition(user: AuthenticatedUser, id: string, to: ContentStatus, note?: string) {
    const item = await this.item(user, id);
    if (!CONTENT_TRANSITIONS[item.status]?.includes(to)) invalid('INVALID_TRANSITION');
    if (!allowedTransitions(item.status, user.role).includes(to)) forbidden();
    // Authors may only move their own items (submit / withdraw).
    if (
      (to === 'submitted' || to === 'draft') &&
      item.submittedBy.id !== user.id &&
      !user.permissions.includes('content.publish')
    )
      forbidden();
    if (to === 'changes_requested' && !note?.trim()) invalid('NOTE_REQUIRED');
    const by = await this.actor(user);
    const updated: ReviewItem = {
      ...item,
      status: to,
      assignedTo: to === 'in_review' ? by : item.assignedTo,
      history: [
        ...item.history,
        { at: nowIso(), from: item.status, to, by, note: note?.slice(0, 2000) },
      ],
      updatedAt: nowIso(),
    };
    await this.store.replace(ITEMS, updated as ReviewItem & Entity);

    const target = CONTENT_COLLECTION[item.contentType];
    if (target && (to === 'published' || to === 'archived')) {
      const ref = { collection: target, scope: '' };
      const content = await this.store.find<Entity>(ref, item.contentId);
      if (content) await this.store.replace(ref, { ...content, status: to, updatedAt: nowIso() });
    }
    if (to === 'changes_requested' || to === 'approved' || to === 'published') {
      const title =
        to === 'changes_requested'
          ? 'পরিবর্তনের অনুরোধ'
          : to === 'approved'
            ? 'কনটেন্ট অনুমোদিত'
            : 'কনটেন্ট প্রকাশিত';
      const teacher = item.submittedBy.role === 'teacher';
      await this.notifications.push([item.submittedBy.id], {
        portal: teacher ? 'teacher' : 'admin',
        type: 'content_correction',
        title,
        body: item.title,
        href: teacher ? '/teacher/history' : '/admin/content-review',
        priority: to === 'changes_requested' ? 'high' : 'normal',
      });
    }
    await this.audit.record({
      actor: user,
      category: 'content',
      action: `review.${to}`,
      target: { type: item.contentType, id: item.contentId, label: item.title },
      details: note?.slice(0, 200),
    });
    return updated;
  }

  async comment(user: AuthenticatedUser, id: string, text: string) {
    const item = await this.item(user, id);
    const updated = {
      ...item,
      comments: [
        ...item.comments,
        {
          id: RecordStoreService.newId('c'),
          author: await this.actor(user),
          text: text.slice(0, 4000),
          at: nowIso(),
        },
      ],
      updatedAt: nowIso(),
    };
    return this.store.replace(ITEMS, updated);
  }

  async suggest(user: AuthenticatedUser, id: string, field: string, from: string, to: string) {
    if (!user.permissions.some((p) => REVIEWER_PERMS.includes(p))) forbidden();
    const item = await this.item(user, id);
    const s = {
      id: RecordStoreService.newId('s'),
      field,
      from,
      to,
      by: await this.actor(user),
      at: nowIso(),
      state: 'open' as const,
    };
    return this.store.replace(ITEMS, {
      ...item,
      suggestions: [...item.suggestions, s],
      updatedAt: nowIso(),
    });
  }

  /** Accept/reject a suggestion. The author (or a reviewer) decides. */
  async resolveSuggestion(
    user: AuthenticatedUser,
    id: string,
    suggestionId: string,
    accept: boolean,
  ) {
    const item = await this.item(user, id);
    const s = item.suggestions.find((x) => x.id === suggestionId) ?? notFound('Suggestion');
    let preview = item.preview;
    if (accept && s.from) preview = preview.split(s.from).join(s.to);
    return this.store.replace(ITEMS, {
      ...item,
      preview,
      suggestions: item.suggestions.map((x) =>
        x.id === suggestionId
          ? { ...x, state: accept ? ('accepted' as const) : ('rejected' as const) }
          : x,
      ),
      updatedAt: nowIso(),
    });
  }

  /** Teacher authoring: creates/updates a question as a draft (or submitted) and its review item. */
  async saveQuestion(user: AuthenticatedUser, q: Question, submit: boolean) {
    const actor = await this.actor(user);
    const status: ContentStatus = submit ? 'submitted' : 'draft';
    const exists = await this.store.find<Question & Entity>(QUESTIONS, q.id);
    const now = nowIso();
    if (exists && exists.status === 'published' && !user.permissions.includes('questions.manage')) {
      // Editing a published question creates a new draft revision instead of unpublishing it.
      q = { ...q, id: RecordStoreService.newId('q') };
    }
    const current = q.id === exists?.id ? exists : undefined;
    const saved: Question = current
      ? {
          ...current,
          ...q,
          status,
          version: current.version + 1,
          versions: [
            ...(current.versions ?? []),
            { version: current.version, at: now, by: actor.name, summary: 'সম্পাদনা' },
          ],
          updatedAt: now,
        }
      : {
          ...q,
          status,
          version: 1,
          provenance: q.provenance ?? 'teacher_uploaded',
          createdAt: now,
          updatedAt: now,
        };
    await this.store.upsert(QUESTIONS, saved as Question & Entity);

    const title = `প্রশ্ন: ${saved.stem.replace(/\*\*|\$/g, '').slice(0, 60)}`;
    const preview = `${saved.stem}\n\n**উত্তর:** ${saved.answer}\n\n**ব্যাখ্যা:** ${saved.explanation}`;
    const [open] = await this.store.all<ReviewItem & Entity>(ITEMS, [
      {
        contentType: ['question'],
        contentId: [saved.id],
        status: ['draft', 'submitted', 'in_review', 'changes_requested', 'approved'],
      },
    ]);
    if (open) {
      await this.store.replace(ITEMS, {
        ...open,
        status,
        preview,
        title,
        history: [...open.history, { at: now, from: open.status, to: status, by: actor }],
        updatedAt: now,
      });
    } else {
      const item: ReviewItem = {
        id: RecordStoreService.newId('rv'),
        contentType: 'question',
        contentId: saved.id,
        title,
        subjectId: saved.subjectId,
        status,
        priority: 'normal',
        submittedBy: actor,
        preview,
        comments: [],
        suggestions: [],
        history: [{ at: now, from: null, to: status, by: actor }],
        createdAt: now,
        updatedAt: now,
      };
      await this.store.insert(ITEMS, item as ReviewItem & Entity);
    }
    if (submit)
      await this.notifications.pushToPortal(
        'teacher',
        {
          type: 'content_correction',
          title: 'নতুন কনটেন্ট রিভিউয়ের অপেক্ষায়',
          body: title,
          href: '/teacher/review',
          priority: 'normal',
        },
        { roles: ['content_reviewer'] },
      );
    return saved;
  }
}
