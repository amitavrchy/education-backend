import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { RolesModule } from './roles/roles.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AiTutorModule } from './ai-tutor/ai-tutor.module.js';
import { AiKnowledgeModule } from './ai-knowledge/ai-knowledge.module.js';
import { AnswerEvaluationModule } from './answer-evaluation/answer-evaluation.module.js';
import { QuestionGenerationModule } from './question-generation/question-generation.module.js';
import { DocumentProcessingModule } from './document-processing/document-processing.module.js';
import { StudentsModule } from './students/students.module.js';
import { TeachersModule } from './teachers/teachers.module.js';
import { ParentsModule } from './parents/parents.module.js';
import { InstitutionsModule } from './institutions/institutions.module.js';
import { AcademicYearsModule } from './academic-years/academic-years.module.js';
import { EducationBoardsModule } from './education-boards/education-boards.module.js';
import { ClassesModule } from './classes/classes.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { SubjectsModule } from './subjects/subjects.module.js';
import { BooksModule } from './books/books.module.js';
import { ChaptersModule } from './chapters/chapters.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { QuestionBankModule } from './question-bank/question-bank.module.js';
import { BoardQuestionsModule } from './board-questions/board-questions.module.js';
import { ExaminationsModule } from './examinations/examinations.module.js';
import { SubmissionsModule } from './submissions/submissions.module.js';
import { StudyPlansModule } from './study-plans/study-plans.module.js';
import { NotesModule } from './notes/notes.module.js';
import { VideosModule } from './videos/videos.module.js';
import { PracticalLabModule } from './practical-lab/practical-lab.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { CommunityModule } from './community/community.module.js';
import { CareerGuidanceModule } from './career-guidance/career-guidance.module.js';
import { ScholarshipsModule } from './scholarships/scholarships.module.js';
import { NoticesModule } from './notices/notices.module.js';
import { AssignmentsModule } from './assignments/assignments.module.js';
import { LiveClassesModule } from './live-classes/live-classes.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ModerationModule } from './moderation/moderation.module.js';
import { AdminModule } from './admin/admin.module.js';

/** Every business module. Add new modules here, not in AppModule. */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    AuditLogsModule,
    UploadsModule,
    NotificationsModule,
    AiTutorModule,
    AiKnowledgeModule,
    AnswerEvaluationModule,
    QuestionGenerationModule,
    DocumentProcessingModule,
    StudentsModule,
    TeachersModule,
    ParentsModule,
    InstitutionsModule,
    AcademicYearsModule,
    EducationBoardsModule,
    ClassesModule,
    GroupsModule,
    SubjectsModule,
    BooksModule,
    ChaptersModule,
    TopicsModule,
    QuestionBankModule,
    BoardQuestionsModule,
    ExaminationsModule,
    SubmissionsModule,
    StudyPlansModule,
    NotesModule,
    VideosModule,
    PracticalLabModule,
    AnalyticsModule,
    CommunityModule,
    CareerGuidanceModule,
    ScholarshipsModule,
    NoticesModule,
    AssignmentsModule,
    LiveClassesModule,
    SubscriptionsModule,
    PaymentsModule,
    ReportsModule,
    ModerationModule,
    AdminModule,
  ],
})
export class DomainModule {}
