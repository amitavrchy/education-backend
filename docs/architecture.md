# ShikkhaAI Backend — Architecture

## Goals

- Modular monolith first: one deployable NestJS app with strict module boundaries, so
  heavy parts (AI, document processing) can later move to separate worker processes.
- Privacy by default: most users are minors; record-level access is enforced in code.
- Vendor-neutral integrations: AI, OCR, speech, storage, email, SMS and payments sit behind
  interfaces, and each one defaults to a disabled or console implementation.

## Layers

```
HTTP request
  └─ main.ts pipeline: helmet → CORS → body limits → /api/v1 prefix
       └─ Global guards (in order): JwtAuthGuard → RolesGuard → PermissionsGuard → ThrottlerGuard
            └─ ValidationPipe (DTO whitelist + transform)
                 └─ Controller (thin: HTTP only)
                      └─ Service (business rules, AccessPolicyService for ownership)
                           ├─ PrismaService (PostgreSQL)
                           ├─ Queues (BullMQ → processors in the owning module)
                           ├─ Storage / AI / Email … (injected by token, swappable)
                           └─ EventEmitter (in-process domain events)
       └─ ResponseEnvelopeInterceptor → { success: true, data, meta? }
       └─ AllExceptionsFilter          → { success: false, statusCode, code, message, errors? }
```

| Folder | Responsibility |
| --- | --- |
| `src/config` | Zod-validated env (`configuration.ts`) + typed namespaces (`app`, `database`, `redis`, `jwt`, `storage`, `integrations`) |
| `src/common` | Cross-cutting code with no business logic: guards, decorators, filters, interceptors, pipes, DTOs, enums, permission catalogue |
| `src/database` | `PrismaModule` (one client per process, lazy connection) and idempotent seeds |
| `src/infrastructure` | Technical capabilities: Redis, BullMQ queues, storage abstraction, events, logging, rate limiting |
| `src/integrations` | Third-party adapters behind interfaces (AI, speech, OCR, file storage, email, SMS, payments) |
| `src/modules` | Business modules, one folder per bounded context, registered in `domain.module.ts` |
| `src/health` | `/api/v1/health` (liveness) and `/api/v1/health/ready` (PostgreSQL + Redis) |

## Authentication and authorization

1. **Authentication** (`JwtAuthGuard`, global): every route needs a Bearer access token unless it is marked `@Public()`.
   Tokens are short-lived JWTs (HS256) with issuer and audience checks. Refresh tokens are
   opaque random strings stored only as SHA-256 hashes in `user_sessions`, which allows rotation and revocation.
2. **Coarse authorization** (`@Roles()`, `@RequirePermissions()`): may this caller use this endpoint?
   Permissions follow `resource:action:scope` (`own`, `assigned`, `institution`, `any`).
3. **Record-level authorization** (`AccessPolicyService`): may this caller see this student's record?
   - Student: only their own records.
   - Teacher: only students in classes listed in `teacher_assignments`.
   - Institution admin: only rows with their `institutionId`.
   - Parent: only children with a verified `parent_student_links` row.
   - Super admin: no implicit bypass. It holds an explicit permission list, and there is deliberately
     no `submissions:read:any` permission.
   - Denials surface as 404, so callers can't probe which records exist.

Roles and permissions mirror the frontend (10 roles, `src/common/auth/permissions.ts`). The effective matrix is the
admin-editable `permissionMatrix` document, resolved per request; `@RequirePermissions` uses any-of semantics like
the frontend's `hasPermission()`. Record-level access is `AccessPolicyService` (student/guardian/institution/staff
by data *area*) plus per-collection rules in `src/modules/records/resource-registry.ts`.
Auth flows (password, OTP login, OTP registration, reset, refresh rotation, logout) are implemented; see
`docs/frontend-integration.md`.

## Multi-tenancy

Institutions are tenants. Tenant-owned rows carry `institutionId` (null means platform or national scope),
and role assignments (`user_roles`) can be scoped to an institution. Every query in an
institution-scoped service must filter by `user.institutionId`, and `AccessPolicyService.assertCanAccessInstitution` guards cross-tenant ids.
A future step can add PostgreSQL row-level security as defence in depth.

## Data

- PostgreSQL via Prisma 7 (driver adapter `@prisma/adapter-pg`, generated client in `src/generated/prisma`).
- Security data is normalized: `users` (credentials), `user_sessions`, `otp_challenges`, `stored_files`.
- Domain data is a **contract store**: `records(collection, scope, id, data jsonb, owner_id, institution_id)` holds every
  entity of the frontend's typed contracts (`src/contracts`, mirrored from the frontend), `documents` holds
  singletons. `RecordStoreService` implements filtering/search/sort/pagination in SQL over JSONB (GIN index).
  Rules that must be server-side live in dedicated services: exam scoring & timing (`exams`), XP/mastery/streaks/
  badges/missions (`progress`), content workflow (`review`), prices/coupons/refunds (`billing`), quotas (`usage`),
  guardian visibility (`guardian`, `access`), tutor generation (`ai-tutor`). Generic writes to server-owned
  collections (attempts, mastery, examAttempts, gamification…) are refused.
- Every staff write to an audited collection is appended to `auditLogs` (no update/delete path).
- snake_case tables, timestamps everywhere; text ids so seeded demo ids (`u-student-1`) and generated ids coexist.
- Binaries never go into PostgreSQL: `stored_files` keeps the storage key, MIME type, size, checksum and processing status.

## Background jobs

BullMQ on Redis. Queues: `pdf-processing`, `ocr-processing`, `ai-document-indexing`,
`question-generation`, `ai-answer-evaluation`, `email-notifications`, `report-generation`.

- Producers are services (`@InjectQueue`). Payloads carry IDs only, never file contents or personal data.
- Processors live in `modules/<module>/processors/` and extend `ToggleableWorkerHost`.
  `QUEUE_WORKERS_ENABLED=false` lets an instance enqueue jobs without consuming them.
- Defaults: 3 attempts with exponential backoff and bounded retention. Producers pass a `jobId` for idempotency.

## AI

| Capability | Contract | Location |
| --- | --- | --- |
| Chat completion / streaming | `ChatModelProvider` | `integrations/ai-providers` |
| Embeddings | `EmbeddingProvider` | `integrations/ai-providers` |
| Image understanding | `ImageUnderstandingProvider` | `integrations/ai-providers` |
| Speech-to-text / text-to-speech | `SpeechToTextProvider`, `TextToSpeechProvider` | `integrations/speech-services` |
| OCR | `OcrProvider` | `integrations/ocr-services` |
| Vector search | `VectorStore` | `modules/ai-knowledge` |
| Knowledge retrieval | `KnowledgeRetrievalService` | `modules/ai-knowledge` |
| RAG | `RagService` | `modules/ai-tutor` |
| Answer evaluation | `AnswerEvaluator`, queue | `modules/answer-evaluation` |
| Question generation | queue + types | `modules/question-generation` |

`AI_PROVIDER=none` (the default) makes AI endpoints answer 503. `AI_PROVIDER=mock` returns offline fake answers for frontend work.
To add a vendor, write one adapter class and add a case in `AiProvidersModule`. No domain code changes.

## Security baseline

helmet; an allow-listed CORS origin list; JSON body limit; global DTO whitelisting (`forbidNonWhitelisted`);
rate limiting (stricter on auth routes); pino log redaction of the authorization header, cookies, passwords and tokens;
upload validation (size, MIME type, magic bytes) and random non-guessable storage keys; an append-only `audit_logs` table;
guardian-consent fields on student profiles; and a generic 500 that never leaks internals.
