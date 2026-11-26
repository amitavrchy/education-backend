import * as H from './resource-hooks.js';
import {
  and,
  auth,
  inst,
  match,
  perm,
  pub,
  self,
  student,
  type GlobalResourceDef,
  type ResourceDef,
  type ScopedResourceDef,
} from './resource.types.js';

/** `examAttempts` → `exam-attempts` (same as the frontend's defaultApiPath). */
export const kebab = (collection: string) =>
  collection.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

type GlobalInput = Omit<GlobalResourceDef, 'path' | 'scoped'> & { path?: string };
type ScopedInput = Omit<ScopedResourceDef, 'path' | 'scoped'> & { path?: string };

const g = (d: GlobalInput): GlobalResourceDef => ({
  ...d,
  path: d.path ?? kebab(d.collection),
  scoped: false,
});
const s = (d: ScopedInput): ScopedResourceDef => ({
  ...d,
  path: d.path ?? kebab(d.collection),
  scoped: true,
});

/** Read for everyone (marketing pages, signup), write for one permission. */
const catalog = (
  collection: string,
  writePerm: Parameters<typeof perm>,
  extra: Partial<GlobalInput> = {},
): GlobalResourceDef =>
  g({
    collection,
    read: [pub],
    create: [perm(...writePerm)],
    update: [perm(...writePerm)],
    remove: [perm(...writePerm)],
    timestamps: false,
    audit: 'content',
    ...extra,
  });

const curriculum = (collection: string, searchFields: string[], sortBy?: string) =>
  catalog(collection, ['curriculum.manage'], {
    searchFields,
    defaultSort: sortBy ? { sortBy, sortOrder: 'asc' } : undefined,
  });

const NOBODY: never[] = [];

/**
 * Every collection the frontend reads or writes through its generic repository, with the same
 * REST path (`defaultApiPath`), search fields and default sort as its mock repository, plus
 * server-side access rules. Composite operations live in dedicated controllers.
 */
export const RESOURCES: ResourceDef[] = [
  // ── Curriculum (frontend services/curriculum.service.ts) ──────────────
  curriculum('levels', ['name.bn', 'name.en', 'code'], 'order'),
  curriculum('curriculumVersions', ['name']),
  curriculum('academicYears', ['label'], 'label'),
  curriculum('examYears', ['year'], 'year'),
  curriculum('boards', ['name.bn', 'name.en', 'code']),
  curriculum('groups', ['name.bn', 'name.en']),
  curriculum('classLevels', ['name.bn', 'name.en'], 'grade'),
  curriculum('subjects', ['name.bn', 'name.en', 'code']),
  curriculum('papers', ['name.bn', 'name.en']),
  curriculum('chapters', ['title.bn', 'title.en', 'description.bn', 'description.en']),
  curriculum('topics', ['title.bn', 'title.en'], 'order'),
  curriculum('outcomes', ['text.bn', 'text.en', 'code']),
  curriculum('migrations', ['note']),
  curriculum('curriculumUpdates', ['title', 'description']),

  // ── Library, archives, audio ──────────────────────────────────────────
  catalog('books', ['books.manage'], {
    timestamps: true,
    entity: 'Book',
    idPrefix: 'book',
    searchFields: ['title.bn', 'title.en', 'publisher', 'edition'],
  }),
  // Per-book teacher avatars. Students read them; their usage counters change only through
  // /avatar/* (sessions, questions, feedback), so clients can't edit the stats.
  g({
    collection: 'bookAvatars',
    entity: 'Avatar',
    idPrefix: 'av',
    searchFields: ['name.bn', 'name.en', 'title.bn', 'title.en'],
    read: [auth],
    create: [perm('books.manage', 'kb.manage', 'content.review', 'teacher.dashboard')],
    update: [perm('books.manage', 'kb.manage', 'content.review', 'teacher.dashboard')],
    remove: [perm('books.manage', 'kb.manage')],
    audit: 'content',
  }),
  g({
    collection: 'avatarReports',
    entity: 'AvatarReport',
    searchFields: ['question', 'reason'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    ownerField: 'studentId',
    read: [
      self('studentId'),
      perm('books.manage', 'kb.manage', 'content.review', 'teacher.dashboard'),
    ],
    // Students report through POST /avatar/:studentId/messages/:id/report.
    create: NOBODY,
    update: [perm('books.manage', 'kb.manage', 'content.review', 'teacher.dashboard')],
    remove: [perm('books.manage', 'kb.manage')],
    audit: 'content',
  }),
  catalog('boardPapers', ['board.manage'], { searchFields: ['title'], entity: 'BoardPaper' }),
  g({
    collection: 'institutionPapers',
    entity: 'InstitutionPaper',
    searchFields: ['title', 'extractedText'],
    institutionField: 'institutionId',
    read: [
      and(auth, match({ visibility: ['public'] })),
      inst('institutionId'),
      perm('institutionPapers.moderate'),
    ],
    create: [perm('institutionPapers.moderate', 'teacher.dashboard')],
    update: [
      perm('institutionPapers.moderate'),
      and(perm('teacher.dashboard'), inst('institutionId')),
    ],
    remove: [perm('institutionPapers.moderate'), perm('users.manage')],
    hooks: H.institutionPapersHooks,
    audit: 'content',
  }),
  catalog('audioLessons', ['books.manage', 'curriculum.manage'], {
    searchFields: ['title.bn', 'title.en'],
  }),

  // ── Question bank ─────────────────────────────────────────────────────
  g({
    collection: 'questions',
    entity: 'Question',
    idPrefix: 'q',
    searchFields: ['stem', 'answer', 'tags', 'passage', 'cqParts'],
    read: [
      and(auth, match({ status: ['published'] })),
      perm('questions.manage', 'content.create', 'content.review', 'board.manage'),
    ],
    create: [perm('questions.manage', 'content.create', 'board.manage')],
    update: [perm('questions.manage', 'content.create', 'content.review', 'board.manage')],
    remove: [perm('questions.manage')],
    hooks: H.questionsHooks,
    audit: 'content',
  }),
  g({
    collection: 'contentReports',
    timestamps: false,
    searchFields: ['reason', 'details', 'refId'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    read: [self('reporterId'), perm('moderation.handle', 'content.review', 'questions.manage')],
    create: [auth],
    update: [perm('moderation.handle', 'content.review', 'questions.manage')],
    remove: [perm('moderation.handle')],
    hooks: H.contentReportsHooks,
    audit: 'content',
  }),

  // ── Exams ─────────────────────────────────────────────────────────────
  g({
    collection: 'exams',
    entity: 'Exam',
    idPrefix: 'ex',
    searchFields: ['title'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    institutionField: 'institutionId',
    // Catalogue exams, the caller's own personal exams, and their institution's exams.
    read: [
      and(
        auth,
        match({ 'createdBy.role': ['system', 'content_manager', 'platform_admin', 'super_admin'] }),
      ),
      self('createdBy.id'),
      inst('institutionId'),
      perm('exams.manage'),
    ],
    create: [perm('exams.manage', 'exam.create')],
    update: [
      perm('exams.manage'),
      and(perm('exam.create'), inst('institutionId')),
      and(perm('exam.create'), self('createdBy.id')),
    ],
    remove: [perm('exams.manage'), and(perm('exam.create'), inst('institutionId'))],
    hooks: H.examsHooks,
    audit: 'content',
  }),
  g({
    collection: 'examTemplates',
    timestamps: false,
    searchFields: ['name.bn', 'name.en'],
    read: [auth],
    create: [perm('exams.manage', 'exam.create')],
    update: [perm('exams.manage', 'exam.create')],
    remove: [perm('exams.manage')],
    audit: 'content',
  }),

  // ── Knowledge base & AI operations ────────────────────────────────────
  g({
    collection: 'kbPassages',
    read: [auth],
    create: [perm('kb.manage')],
    update: [perm('kb.manage')],
    remove: [perm('kb.manage')],
    timestamps: false,
    searchFields: ['text', 'keywords', 'bookTitle', 'chapterTitle'],
    audit: 'ai',
  }),
  g({
    collection: 'kbCollections',
    read: [perm('kb.view', 'kb.manage')],
    create: [perm('kb.manage')],
    update: [perm('kb.manage')],
    remove: [perm('kb.manage')],
    timestamps: false,
    audit: 'ai',
  }),
  g({
    collection: 'promptTemplates',
    read: [perm('kb.view', 'kb.manage')],
    create: [perm('kb.manage')],
    update: [perm('kb.manage')],
    remove: [perm('kb.manage')],
    searchFields: ['name', 'body'],
    audit: 'ai',
  }),
  g({
    collection: 'aiLogs',
    read: [perm('kb.view', 'kb.manage', 'moderation.handle')],
    create: [perm('kb.manage')],
    update: [perm('kb.manage', 'moderation.handle')],
    remove: [perm('kb.manage')],
    timestamps: false,
    searchFields: ['query', 'detail'],
    defaultSort: { sortBy: 'at', sortOrder: 'desc' },
    audit: 'ai',
  }),
  g({
    collection: 'evalDatasets',
    read: [perm('kb.view', 'kb.manage')],
    create: [perm('kb.manage')],
    update: [perm('kb.manage')],
    remove: [perm('kb.manage')],
    timestamps: false,
    audit: 'ai',
  }),
  g({
    collection: 'ingestionJobs',
    entity: 'IngestionJob',
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    read: [perm('kb.view', 'kb.manage', 'books.manage')],
    create: [perm('kb.manage', 'books.manage')],
    update: [perm('kb.manage', 'books.manage')],
    remove: [perm('kb.manage')],
    hooks: H.ingestionJobsHooks,
    audit: 'content',
  }),

  // ── People & institutions ─────────────────────────────────────────────
  g({
    collection: 'users',
    entity: 'User',
    idPrefix: 'u',
    searchFields: ['name', 'email', 'phone', 'id'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    institutionField: 'institutionId',
    read: [self('id'), perm('users.view', 'users.manage', 'users.support')],
    create: [perm('users.manage')],
    update: [self('id'), perm('users.manage', 'users.support')],
    remove: [perm('users.manage')],
    hooks: H.usersHooks,
    audit: 'account',
  }),
  g({
    collection: 'studentProfiles',
    searchFields: ['name'],
    ownerField: 'id',
    institutionField: 'institutionId',
    read: [student('id', 'profile')],
    create: [self('id'), perm('users.manage')],
    update: [self('id'), perm('users.manage')],
    remove: [perm('users.manage')],
    audit: 'account',
  }),
  g({
    collection: 'guardianLinks',
    timestamps: false,
    ownerField: 'guardianId',
    read: [self('guardianId'), self('studentId'), perm('users.view', 'users.support')],
    create: [perm('users.manage')],
    update: [self('guardianId'), self('studentId'), perm('users.manage', 'users.support')],
    remove: [perm('users.manage')],
    hooks: H.guardianLinksHooks,
    audit: 'account',
  }),
  g({
    collection: 'teacherFeedback',
    timestamps: false,
    defaultSort: { sortBy: 'at', sortOrder: 'desc' },
    ownerField: 'studentId',
    read: [student('studentId', 'teacherFeedback'), self('teacherId')],
    create: [perm('teacher.dashboard')],
    update: [self('teacherId'), perm('users.manage'), student('studentId', 'teacherFeedback')],
    remove: [self('teacherId'), perm('users.manage')],
    hooks: H.teacherFeedbackHooks,
  }),
  g({
    collection: 'teacherProfiles',
    searchFields: ['name', 'email'],
    institutionField: 'institutionId',
    read: [self('userId'), inst('institutionId'), perm('teachers.manage', 'users.view')],
    create: [perm('teachers.manage')],
    update: [self('userId'), perm('teachers.manage'), perm('users.manage')],
    remove: [perm('teachers.manage'), perm('users.manage')],
    audit: 'account',
  }),
  g({
    collection: 'institutions',
    searchFields: ['name.bn', 'name.en', 'code', 'district'],
    read: [auth],
    create: [perm('users.manage')],
    update: [perm('users.manage')],
    remove: [perm('users.manage')],
    audit: 'account',
  }),
  g({
    collection: 'institutionMembers',
    searchFields: ['name', 'email', 'rollNo'],
    institutionField: 'institutionId',
    read: [
      self('userId'),
      and(perm('teacher.dashboard'), inst('institutionId')),
      perm('users.view'),
    ],
    create: [perm('users.manage', 'teacher.dashboard')],
    update: [perm('users.manage'), perm('users.manage')],
    remove: [perm('users.manage'), perm('users.manage')],
    hooks: H.tenantHooks,
    audit: 'account',
  }),
  g({
    collection: 'privacyRequests',
    searchFields: ['userName', 'type'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    read: [self('userId'), perm('users.view', 'users.support')],
    create: [auth],
    update: [perm('users.support', 'users.manage')],
    remove: [perm('users.manage')],
    hooks: H.privacyRequestsHooks,
    audit: 'account',
  }),

  // ── Teacher / reviewer ────────────────────────────────────────────────
  g({
    collection: 'reviewItems',
    entity: 'ReviewItem',
    searchFields: ['title', 'preview'],
    defaultSort: { sortBy: 'updatedAt', sortOrder: 'desc' },
    read: [self('submittedBy.id'), perm('content.review', 'content.approve', 'content.publish')],
    // Status changes go through POST /review-items/:id/transition; generic writes are for metadata.
    create: [perm('content.review', 'content.publish')],
    update: [perm('content.review', 'content.publish')],
    remove: [perm('content.publish')],
    audit: 'content',
  }),
  g({
    collection: 'rubrics',
    entity: 'Rubric',
    searchFields: ['name'],
    read: [perm('teacher.dashboard', 'admin.access', 'evaluation.review')],
    create: [perm('rubric.manage', 'content.create')],
    update: [perm('rubric.manage', 'content.create')],
    remove: [perm('rubric.manage')],
    audit: 'content',
  }),

  // ── Institution workspace ─────────────────────────────────────────────
  ...(['academicSessions', 'classGroups'] as const).map((collection) =>
    g({
      collection,
      timestamps: false,
      institutionField: 'institutionId',
      read: [inst('institutionId'), perm('users.view')],
      create: [perm('users.manage', 'teacher.dashboard')],
      update: [and(perm('teacher.dashboard'), inst('institutionId')), perm('users.manage')],
      remove: [perm('users.manage'), perm('users.manage')],
      hooks: H.tenantHooks,
      audit: 'account',
    }),
  ),
  g({
    collection: 'assignments',
    entity: 'Assignment',
    searchFields: ['title'],
    defaultSort: { sortBy: 'dueAt', sortOrder: 'desc' },
    institutionField: 'institutionId',
    read: [inst('institutionId'), self('teacherId'), perm('users.view')],
    create: [perm('assignment.manage')],
    update: [self('teacherId'), perm('users.manage')],
    remove: [self('teacherId'), perm('users.manage')],
    hooks: H.assignmentsHooks,
  }),
  g({
    collection: 'submissions',
    entity: 'Submission',
    searchFields: ['studentName'],
    ownerField: 'studentId',
    read: [student('studentId', 'scores')],
    create: [auth],
    update: [self('studentId'), and(perm('submission.review'), student('studentId', 'scores'))],
    remove: [and(perm('submission.review'), student('studentId', 'scores'))],
    hooks: H.submissionsHooks,
  }),
  g({
    collection: 'announcements',
    entity: 'Announcement',
    searchFields: ['title', 'body'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    institutionField: 'institutionId',
    read: [inst('institutionId'), perm('users.view', 'notifications.manage')],
    create: [perm('teacher.dashboard')],
    update: [and(perm('teacher.dashboard'), inst('institutionId'))],
    remove: [and(perm('teacher.dashboard'), inst('institutionId'))],
    hooks: H.tenantHooks,
  }),
  g({
    collection: 'institutionResources',
    entity: 'Resource',
    searchFields: ['title'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    institutionField: 'institutionId',
    read: [inst('institutionId'), perm('users.view')],
    create: [perm('teacher.dashboard')],
    update: [and(perm('teacher.dashboard'), inst('institutionId'))],
    remove: [and(perm('teacher.dashboard'), inst('institutionId'))],
    hooks: H.tenantHooks,
  }),

  // ── Billing (mutations with rules go through /billing/*) ──────────────
  catalog('plans', ['billing.manage'], { timestamps: true, entity: 'Plan', audit: 'billing' }),
  ...(
    [
      ['subscriptions', ['userName', 'planCode'], { sortBy: 'startedAt', sortOrder: 'desc' }, true],
      ['payments', ['userName', 'invoiceNo'], { sortBy: 'createdAt', sortOrder: 'desc' }, false],
      ['refunds', ['userName', 'reason'], undefined, true],
    ] as const
  ).map(([collection, searchFields, defaultSort, timestamps]) =>
    g({
      collection,
      searchFields: [...searchFields],
      defaultSort,
      timestamps,
      ownerField: 'userId',
      read: [self('userId'), perm('billing.view', 'billing.manage')],
      create: [perm('billing.manage')],
      update: [perm('billing.manage')],
      remove: [perm('billing.manage')],
      audit: 'billing',
    }),
  ),
  g({
    collection: 'coupons',
    entity: 'Coupon',
    searchFields: ['code', 'description'],
    read: [perm('billing.view', 'billing.manage')],
    create: [perm('billing.manage')],
    update: [perm('billing.manage')],
    remove: [perm('billing.manage')],
    audit: 'billing',
  }),

  // ── Notifications ─────────────────────────────────────────────────────
  g({
    collection: 'notifications',
    idPrefix: 'ntf',
    timestamps: false,
    searchFields: ['title', 'body'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    ownerField: 'userId',
    read: [self('userId')],
    create: [auth],
    update: [self('userId')],
    remove: [self('userId')],
    hooks: H.notificationsHooks,
  }),
  catalog('notices', ['notifications.manage'], {
    searchFields: ['title.bn', 'title.en'],
    defaultSort: { sortBy: 'publishedAt', sortOrder: 'desc' },
    audit: 'system',
  }),

  // ── Admin operations ──────────────────────────────────────────────────
  g({
    collection: 'moderationCases',
    searchFields: ['subject', 'excerpt', 'reporter'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    read: [perm('moderation.handle', 'institutionPapers.moderate')],
    create: [perm('moderation.handle', 'institutionPapers.moderate')],
    update: [perm('moderation.handle', 'institutionPapers.moderate')],
    remove: [perm('moderation.handle')],
    audit: 'content',
  }),
  g({
    collection: 'securityAlerts',
    timestamps: false,
    defaultSort: { sortBy: 'at', sortOrder: 'desc' },
    read: [perm('security.manage', 'audit.view')],
    create: [perm('security.manage')],
    update: [perm('security.manage')],
    remove: [perm('security.manage')],
    audit: 'security',
  }),
  g({
    collection: 'apiKeys',
    timestamps: false,
    read: [perm('security.manage', 'system.config')],
    create: [perm('security.manage')],
    update: [perm('security.manage')],
    remove: [perm('security.manage')],
    hooks: H.apiKeysHooks,
    audit: 'security',
  }),
  g({
    collection: 'auditLogs',
    timestamps: false,
    searchFields: ['action', 'target.label', 'actor.name'],
    defaultSort: { sortBy: 'at', sortOrder: 'desc' },
    // Append-only. Staff clients may add an entry (the frontend logs admin actions), but the
    // server stamps actor, time and IP; nothing can be edited or deleted.
    read: [perm('audit.view')],
    create: [perm('admin.access')],
    update: NOBODY,
    remove: NOBODY,
    hooks: H.auditLogsHooks,
  }),

  // ── Per-student collections ───────────────────────────────────────────
  // Learning engine: written only by /progress and /exams endpoints (scores and XP are server-side).
  s({
    collection: 'attempts',
    area: 'progress',
    ownerWrite: 'server',
    timestamps: false,
    defaultSort: { sortBy: 'answeredAt', sortOrder: 'desc' },
  }),
  s({ collection: 'mastery', area: 'progress', ownerWrite: 'server', timestamps: false }),
  s({ collection: 'chapterProgress', area: 'progress', ownerWrite: 'server', timestamps: false }),
  s({
    collection: 'activity',
    area: 'studyTime',
    ownerWrite: 'server',
    timestamps: false,
    defaultSort: { sortBy: 'at', sortOrder: 'desc' },
  }),
  s({
    collection: 'examAttempts',
    area: 'scores',
    ownerWrite: 'server',
    timestamps: false,
    searchFields: ['examTitle'],
    defaultSort: { sortBy: 'startedAt', sortOrder: 'desc' },
  }),
  s({
    collection: 'evaluations',
    area: 'scores',
    ownerWrite: 'owner',
    staffWrite: ['evaluation.review'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
    searchFields: ['title', 'questionText'],
    hooks: H.evaluationsHooks,
  }),
  // Planner (guardian "calendar" permission).
  s({
    collection: 'tasks',
    area: 'calendar',
    ownerWrite: 'owner',
    searchFields: ['title', 'notes'],
    defaultSort: { sortBy: 'date', sortOrder: 'asc' },
  }),
  s({ collection: 'goals', area: 'calendar', ownerWrite: 'owner', timestamps: false }),
  // Tutor history: private unless the student shares it with guardians.
  s({
    collection: 'conversations',
    area: 'aiConversations',
    ownerWrite: 'owner',
    searchFields: ['title', 'lastMessagePreview'],
    defaultSort: { sortBy: 'updatedAt', sortOrder: 'desc' },
  }),
  s({
    collection: 'messages',
    area: 'aiConversations',
    ownerWrite: 'owner',
    timestamps: false,
    searchFields: ['content'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'asc' },
    hooks: H.messagesHooks,
  }),
  // Book avatar chats: written by /avatar/* only; guardians get counts via /avatar/:id/usage.
  s({
    collection: 'avatarSessions',
    area: 'aiConversations',
    ownerWrite: 'server',
    timestamps: false,
    defaultSort: { sortBy: 'lastAt', sortOrder: 'desc' },
  }),
  s({
    collection: 'avatarMessages',
    area: 'aiConversations',
    ownerWrite: 'server',
    timestamps: false,
  }),
  s({ collection: 'folders', area: 'private', ownerWrite: 'owner', timestamps: false }),
  // Private study material.
  s({
    collection: 'decks',
    area: 'private',
    ownerWrite: 'owner',
    timestamps: false,
    searchFields: ['name'],
  }),
  s({
    collection: 'cards',
    area: 'private',
    ownerWrite: 'owner',
    searchFields: ['front', 'back', 'tags'],
  }),
  s({
    collection: 'notes',
    area: 'private',
    ownerWrite: 'owner',
    searchFields: ['title', 'content', 'tags'],
    defaultSort: { sortBy: 'updatedAt', sortOrder: 'desc' },
  }),
  s({ collection: 'noteFolders', area: 'private', ownerWrite: 'owner', timestamps: false }),
  s({
    collection: 'bookmarks',
    area: 'private',
    ownerWrite: 'owner',
    timestamps: false,
    searchFields: ['title', 'subtitle'],
    defaultSort: { sortBy: 'createdAt', sortOrder: 'desc' },
  }),
  s({
    collection: 'practiceSets',
    area: 'private',
    ownerWrite: 'owner',
    searchFields: ['name'],
    defaultSort: { sortBy: 'updatedAt', sortOrder: 'desc' },
  }),
  s({ collection: 'reading', area: 'private', ownerWrite: 'owner', timestamps: false }),
  s({ collection: 'ocr', area: 'private', ownerWrite: 'owner', timestamps: false }),
  s({ collection: 'offline', area: 'private', ownerWrite: 'owner', timestamps: false }),
  s({ collection: 'audioProgress', area: 'private', ownerWrite: 'owner', timestamps: false }),
  s({
    collection: 'voice',
    area: 'private',
    ownerWrite: 'owner',
    timestamps: false,
    defaultSort: { sortBy: 'startedAt', sortOrder: 'desc' },
  }),
];

const byPath = new Map(RESOURCES.map((r) => [r.path, r]));
const byCollection = new Map(RESOURCES.map((r) => [r.collection, r]));

export const resourceByPath = (path: string) => byPath.get(path);
export const resourceByCollection = (collection: string) => byCollection.get(collection);

/** Session records are backed by the real user_sessions table (see SessionsController). */
export const RESERVED_PATHS = new Set(['session-records']);
