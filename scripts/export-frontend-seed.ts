/**
 * Exports the frontend's demo data (the same seeds its mock repositories use) to
 * prisma/seed-data/frontend-seed.json.gz, so the API serves exactly what the UI was built against.
 *
 * Run from the backend folder, with the frontend repo checked out next to it:
 *   npm run seed:export
 *
 * It executes the frontend's mock repositories in Node (in-memory mock DB, zero latency) and
 * never contacts a server. The JSON is committed; `prisma db seed` reads it without the frontend.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FRONTEND = process.env.FRONTEND_DIR ?? '../frontend';
const fe = (p: string) =>
  import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), FRONTEND, 'src', p)).href);

async function main() {
  const runtime = await fe('services/core/mock-runtime.ts');
  runtime.configureMockRuntime({ latencyScale: 0, failureRate: 0, offline: false });

  const users = await fe('mock-data/users.ts');
  const auth = await fe('services/auth.service.ts');
  const admin = await fe('services/admin.service.ts');
  const archive = await fe('services/archive.service.ts');
  const audio = await fe('services/audio.service.ts');
  const billing = await fe('services/billing.service.ts');
  const curriculum = await fe('services/curriculum.service.ts');
  const evaluation = await fe('services/evaluation.service.ts');
  const exam = await fe('services/exam.service.ts');
  const flash = await fe('services/flashcards.service.ts');
  const kb = await fe('services/kb.service.ts');
  const library = await fe('services/library.service.ts');
  const notes = await fe('services/notes.service.ts');
  const notif = await fe('services/notification.service.ts');
  const ocr = await fe('services/ocr.service.ts');
  const offline = await fe('services/offline.service.ts');
  const people = await fe('services/people.service.ts');
  const progress = await fe('services/progress.service.ts');
  const question = await fe('services/question.service.ts');
  const review = await fe('services/review.service.ts');
  const school = await fe('services/school.service.ts');
  const planner = await fe('services/study-planner.service.ts');
  const tutor = await fe('services/tutor.service.ts');
  const voice = await fe('services/voice.service.ts');
  const english = await fe('services/english.service.ts');
  const usage = await fe('services/usage.service.ts');
  const guardian = await fe('services/guardian.service.ts');
  const avatar = await fe('services/avatar.service.ts');

  const collections: Record<string, unknown[]> = {};
  const documents: Record<string, unknown> = {};
  const put = async (name: string, load: () => Promise<unknown[]>) => {
    collections[name] = await load();
  };

  // ── Global collections ────────────────────────────────────────────────
  const globals: Record<string, { raw(): Promise<unknown[]> }> = {
    users: auth.usersRepo,
    auditLogs: admin.auditRepo,
    ingestionJobs: admin.ingestionRepo,
    kbCollections: admin.kbCollectionsRepo,
    promptTemplates: admin.promptsRepo,
    aiLogs: admin.aiLogsRepo,
    evalDatasets: admin.evalsRepo,
    moderationCases: admin.moderationRepo,
    securityAlerts: admin.alertsRepo,
    sessionRecords: admin.sessionsAdminRepo,
    apiKeys: admin.apiKeysRepo,
    boardPapers: archive.boardPapersRepo,
    institutionPapers: archive.institutionPapersRepo,
    audioLessons: audio.lessonsRepo,
    plans: billing.plansRepo,
    subscriptions: billing.subscriptionsRepo,
    payments: billing.paymentsRepo,
    coupons: billing.couponsRepo,
    refunds: billing.refundsRepo,
    exams: exam.examsRepo,
    examTemplates: exam.templatesRepo,
    kbPassages: kb.passagesRepo,
    books: library.booksRepo,
    notices: notif.noticesRepo,
    studentProfiles: people.profilesRepo,
    guardianLinks: people.guardianLinksRepo,
    teacherFeedback: people.teacherFeedbackRepo,
    teacherProfiles: people.teacherProfilesRepo,
    institutions: people.institutionsRepo,
    institutionMembers: people.membersRepo,
    privacyRequests: people.privacyRequestsRepo,
    questions: question.questionsRepo,
    contentReports: question.reportsRepo,
    reviewItems: review.reviewItemsRepo,
    rubrics: review.rubricsRepo,
    academicSessions: school.sessionsRepo,
    classGroups: school.classGroupsRepo,
    assignments: school.assignmentsRepo,
    submissions: school.submissionsRepo,
    announcements: school.announcementsRepo,
    institutionResources: school.resourcesRepo,
    bookAvatars: avatar.avatarsRepo,
    avatarReports: avatar.avatarReportsRepo,
  };
  for (const [name, repo] of Object.entries(globals)) await put(name, () => repo.raw());

  const curriculumNames: Record<string, string> = {
    levels: 'levels',
    versions: 'curriculumVersions',
    academicYears: 'academicYears',
    examYears: 'examYears',
    boards: 'boards',
    groups: 'groups',
    classes: 'classLevels',
    subjects: 'subjects',
    papers: 'papers',
    chapters: 'chapters',
    topics: 'topics',
    outcomes: 'outcomes',
    migrations: 'migrations',
    updates: 'curriculumUpdates',
  };
  for (const [key, name] of Object.entries(curriculumNames))
    await put(name, () => curriculum.curriculumRepos[key].raw());

  // Notifications are per portal in the mock; the seeder assigns them to the demo account of that portal.
  await put('notifications', () =>
    notif.notificationService
      .list('student', { includeArchived: true })
      .then(async (s: unknown[]) => [
        ...s,
        ...(await notif.notificationService.list('parent', { includeArchived: true })),
        ...(await notif.notificationService.list('teacher', { includeArchived: true })),
        ...(await notif.notificationService.list('admin', { includeArchived: true })),
      ]),
  );

  // ── Per-student collections ───────────────────────────────────────────
  const accounts = (await auth.usersRepo.raw()) as { id: string; role: string }[];
  const studentIds = accounts.filter((a) => a.role === 'student').map((a) => a.id);
  const guardianIds = accounts.filter((a) => a.role === 'parent').map((a) => a.id);

  for (const id of studentIds) {
    const p = progress.progressRepos(id);
    await put(`attempts:${id}`, () => p.attempts.raw());
    await put(`mastery:${id}`, () => p.mastery.raw());
    await put(`chapterProgress:${id}`, () => p.chapters.raw());
    await put(`activity:${id}`, () => p.activity.raw());
    await put(`examAttempts:${id}`, () => exam.examAttemptsRepo(id).raw());
    const f = flash.flashcardRepos(id);
    await put(`decks:${id}`, () => f.decks.raw());
    await put(`cards:${id}`, () => f.cards.raw());
    const n = notes.notesRepos(id);
    await put(`notes:${id}`, () => n.notes.raw());
    await put(`noteFolders:${id}`, () => n.folders.raw());
    await put(`bookmarks:${id}`, () => question.bookmarksRepo(id).raw());
    await put(`practiceSets:${id}`, () => question.practiceSetsRepo(id).raw());
    await put(`reading:${id}`, () => library.readingRepo(id).raw());
    await put(`evaluations:${id}`, () => evaluation.evaluationRepo(id).raw());
    await put(`ocr:${id}`, () => ocr.ocrRepo(id).raw());
    await put(`offline:${id}`, () => offline.offlineRepo(id).raw());
    await put(`audioProgress:${id}`, () => audio.audioProgressRepo(id).raw());
    await put(`voice:${id}`, () => voice.voiceRepo(id).raw());
    await put(`avatarSessions:${id}`, () => avatar.avatarSessionsRepo(id).raw());
    await put(`avatarMessages:${id}`, () => avatar.avatarMessagesRepo(id).raw());
    await put(`tasks:${id}`, () => planner.taskRepo(id).raw());
    await put(`goals:${id}`, () => planner.studyPlannerService.goals(id));
    await put(`conversations:${id}`, () => tutor.tutorService.conversations(id));
    await put(`folders:${id}`, () => tutor.tutorService.folders(id));
    // Backfill seeded assistant replies, then take every message.
    for (const c of collections[`conversations:${id}`] as { id: string }[])
      await tutor.tutorService.messages(id, c.id);
    await put(`messages:${id}`, () => tutor.tutorService.searchMessages(id, ''));

    documents[`gamification:${id}`] = await progress.progressService.gamification(id);
    documents[`planSettings:${id}`] = await planner.studyPlannerService.settings(id);
    documents[`english:${id}`] = await english.englishService.progress(id);
  }
  for (const a of accounts) documents[`usage:${a.id}`] = (await usage.usageService.get(a.id)).meter;
  for (const id of guardianIds)
    documents[`guardianGoals:${id}`] = {
      id: 'goals',
      items: await guardian.guardianService.goals(id),
    };

  documents.systemConfig = await admin.securityService.config();
  documents.permissionMatrix = {
    id: 'matrix',
    matrix: await admin.securityService.permissionMatrix(),
  };
  documents.aiSettings = await admin.kbService.aiSettings();

  const out = {
    exportedAt: new Date().toISOString(),
    demoUsers: users.demoUsers,
    studentIds,
    collections,
    documents,
  };
  const dir = join(process.cwd(), 'prisma', 'seed-data');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'frontend-seed.json.gz');
  writeFileSync(file, gzipSync(JSON.stringify(out), { level: 9 }));
  const counts = Object.values(collections).reduce((s, c) => s + c.length, 0);
  console.log(
    `Wrote ${file}: ${Object.keys(collections).length} collections, ${counts} records, ${Object.keys(documents).length} documents`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
