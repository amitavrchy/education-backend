import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AiKnowledgeModule } from './ai-knowledge/ai-knowledge.module.js';
import { AiTutorModule } from './ai-tutor/ai-tutor.module.js';
import { AnswerEvaluationModule } from './answer-evaluation/answer-evaluation.module.js';
import { AuditLogsModule } from './audit-logs/audit-logs.module.js';
import { BillingModule } from './billing/billing.module.js';
import { DocumentProcessingModule } from './document-processing/document-processing.module.js';
import { ExamsModule } from './exams/exams.module.js';
import { GuardianModule } from './guardian/guardian.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ProgressModule } from './progress/progress.module.js';
import { QuestionGenerationModule } from './question-generation/question-generation.module.js';
import { RecordsModule } from './records/records.module.js';
import { ReviewModule } from './review/review.module.js';
import { SearchModule } from './search/search.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { UsersModule } from './users/users.module.js';

/**
 * Every business module. Add new modules here, not in AppModule.
 * RecordsModule MUST stay last: its generic `/:resource/...` routes are a catch-all, so every
 * dedicated controller has to be registered before it.
 */
@Module({
  imports: [
    AccessModule,
    AuditLogsModule,
    NotificationsModule,
    UsersModule,
    UploadsModule,
    ProgressModule,
    BillingModule,
    ExamsModule,
    ReviewModule,
    GuardianModule,
    AiKnowledgeModule,
    AiTutorModule,
    AnswerEvaluationModule,
    QuestionGenerationModule,
    DocumentProcessingModule,
    SearchModule,
    AdminModule,
    RecordsModule,
  ],
})
export class DomainModule {}
