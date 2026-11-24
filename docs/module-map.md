# Module Map

| Module | Owns / does |
| --- | --- |
| access | Permission matrix (admin-editable) and `AccessPolicyService` (student data by area) |
| auth | Password/OTP login, OTP registration, reset, refresh rotation, logout, demo role switch |
| users | `GET /users/me` |
| records | Contract store (`records`, `documents`), generic REST adapter for ~80 frontend collections, resource registry with access rules and hooks |
| audit-logs | Append-only audit trail (frontend `AuditLog` shape) |
| notifications | In-app notifications (per user, portal fan-out), email queue |
| progress | Attempts → mastery → chapter progress → activity/XP/streak/badges/missions |
| exams | Attempt lifecycle, server timing and scoring, sanitized questions |
| review | Content workflow state machine, comments, suggestions, teacher question authoring |
| billing | Checkout (mock gateway), coupons, subscriptions, refunds; usage quotas |
| guardian | Link codes, OTP-confirmed linking, permission-filtered child summaries, replies to teachers |
| ai-tutor | Grounded tutor (retrieval + local engine or AI provider), SSE streaming, KB query simulator |
| document-processing | Book ingestion pipeline on the `pdf-processing` queue (text sources → KB passages) |
| uploads | File upload/download with signature checks and access control |
| search | Global search across content and the caller's own study material |
| admin | Live session records, analytics series and overview |
| ai-knowledge, answer-evaluation, question-generation | AI interfaces kept for vendor adapters |

`src/domain/*` holds pure rules ported from the frontend (grading, scoring, progress rules, content workflow, tutor engine).

## Dependency rules

- `modules/*` may depend on `common`, `config`, `database`, `infrastructure`, `integrations` and `domain`.
- Domain modules use `RecordStoreService` for contract data; access rules live in the resource registry.
- `RecordsModule` is imported last in `DomainModule` (its routes are a catch-all).
