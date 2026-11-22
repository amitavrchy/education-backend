# Module Map

Status: ✅ foundation implemented · 🧩 service boundary/interfaces only · ⬜ skeleton (module + empty service)

## Identity and access

| Module | Status | Owns | Notes |
| --- | --- | --- | --- |
| auth | 🧩 | sessions, tokens | Guards, password hasher, token service and DTOs are done; flows answer 501 |
| users | ✅ | `users` | `GET /users/me` |
| roles | ✅ | `roles`, `user_roles` | `getEffectiveAccess(userId)` |
| permissions | ✅ | `permissions`, `role_permissions` | `AccessPolicyService` (ownership and tenancy), unit-tested |
| audit-logs | ✅ | `audit_logs` | `record()` (best effort, append-only) |

## People and tenants

| Module | Status | Owns |
| --- | --- | --- |
| students | ⬜ | `student_profiles` (guardian consent for minors) |
| teachers | ⬜ | `teacher_profiles`, `teacher_assignments` |
| parents | ⬜ | `parent_profiles`, `parent_student_links` |
| institutions | ⬜ | `institutions` |
| admin | ⬜ | platform operations |

## Academic catalog

| Module | Status | Owns |
| --- | --- | --- |
| academic-years | ⬜ | `academic_years` |
| education-boards | ⬜ | `education_boards` (seeded) |
| classes | ⬜ | `classes` (seeded) |
| groups | ⬜ | `groups` (seeded) |
| subjects | ⬜ | `subjects` |
| books | ⬜ | `books` |
| chapters | ⬜ | `chapters` |
| topics | ⬜ | `topics` |

## Assessment (tables to be added)

| Module | Status | Planned tables |
| --- | --- | --- |
| question-bank | ⬜ | `questions`, `question_options`, `question_tags` |
| board-questions | ⬜ | `board_question_papers` |
| examinations | ⬜ | `examinations`, `examination_questions` |
| submissions | ⬜ | `exam_submissions`, `answers` (private: `ACCESS_RULES.examSubmission`) |
| assignments | ⬜ | `assignments`, `assignment_submissions` |
| answer-evaluation | 🧩 | `answer_evaluations`; queue `ai-answer-evaluation` |
| question-generation | 🧩 | `generation_requests`; queue `question-generation` |

## AI and content processing

| Module | Status | Notes |
| --- | --- | --- |
| ai-tutor | 🧩 | `AiChatService`, `RagService`, `POST /ai/tutor/ask` |
| ai-knowledge | 🧩 | `VectorStore` (noop for now), `KnowledgeRetrievalService`, `chunkText()` |
| document-processing | 🧩 | queue `pdf-processing`, `PdfProcessingProcessor` (acknowledges jobs only), pipeline interfaces |
| uploads | ✅ | `UploadsService.store()` → storage + `stored_files` |

## Learning and engagement

| Module | Status | Planned tables |
| --- | --- | --- |
| study-plans | ⬜ | `study_plans`, `learning_progress` |
| notes | ⬜ | `notes` |
| videos | ⬜ | `videos`, `video_progress` |
| practical-lab | ⬜ | `experiments` |
| analytics | ⬜ | aggregates (`ACCESS_RULES.learningAnalytics`) |
| community | ⬜ | `posts`, `comments` |
| career-guidance | ⬜ | `career_paths` |
| scholarships | ⬜ | `scholarships` |
| notices | ⬜ | `notices` |
| live-classes | ⬜ | `live_classes` |
| moderation | ⬜ | `moderation_reports` |

## Communication and billing

| Module | Status | Notes |
| --- | --- | --- |
| notifications | 🧩 | queue `email-notifications` + processor; planned `notifications` table |
| subscriptions | ⬜ | `plans`, `subscriptions`, AI usage quotas |
| payments | ⬜ | `payments`; adapters for bKash, Nagad and SSLCommerz |
| reports | ⬜ | queue `report-generation` |

## Dependency rules

- `modules/*` may depend on `common`, `config`, `database`, `infrastructure` and `integrations` (through tokens).
- Modules talk to each other through exported services or domain events, never through another module's Prisma tables.
- `integrations/*` never imports `modules/*`.
- Global modules: Prisma, Redis, Queues, Storage, Integrations, Permissions (`AccessPolicyService`) and AuditLogs.
