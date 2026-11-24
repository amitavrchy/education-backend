# Frontend integration

The API implements the contract the frontend was built against
(`frontend/docs/architecture/BACKEND_INTEGRATION_PLAN.md`, `frontend/docs/api/*`, `frontend/src/contracts`).

## Run it locally

```bash
npm run docker:up                 # PostgreSQL + Redis
npm run db:deploy                 # migrations
npm run db:seed:reset             # the frontend's demo data (75 accounts, ~44k records)
npm run start:dev                 # http://localhost:4000/api/v1, Swagger at /api/docs
```

For the frontend demo UI set in `.env`: `AUTH_DEMO_MODE=true`, `AI_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`.
Point the frontend at it with `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1` and
`NEXT_PUBLIC_USE_MOCK_API=false` (only when you deliberately test against the real API).

Demo accounts: the frontend's (`student@shikkha.ai`, `parent@…`, `teacher@…`, `reviewer@…`, `content@…`,
`school@…`, `college@…`, `support@…`, `admin@…`, `super@…`). Password `SEED_DEMO_PASSWORD`; in demo mode any
password except `wrongpass`; OTP `123456`.

## Demo data

`prisma/seed-data/frontend-seed.json.gz` is exported from the frontend's own mock repositories
(`npm run seed:export`, needs `../frontend`). The seeder shifts every date forward by the days since export so
relative data ("closes in 3 days", streaks) stays current. Typed contracts are mirrored with `npm run contracts:sync`.

## Generic repository contract (every collection)

| Frontend `Repository` call | HTTP |
| --- | --- |
| `list(params)` | `GET /:path?page&pageSize&search&sortBy&sortOrder&filter[k]=a,b` → `{ data, meta }` |
| `all(filters)` | `GET /:path?all=true&filter[…]` → `{ data: T[] }` |
| `get(id)` / `find(id)` | `GET /:path/:id` |
| `create` / `update` / `remove` | `POST /:path`, `PATCH /:path/:id`, `DELETE /:path/:id` |
| `bulkUpdate` / `bulkRemove` | `PATCH /:path/bulk {ids,patch}`, `POST /:path/bulk-delete {ids}` |
| batch create (generators, imports) | `POST /:path/batch {items}` |
| `replaceAll` (owner study data only) | `PUT /:path/:studentId {items}` |

`:path` is the frontend's `defaultApiPath(collection)`: `examAttempts:u-1` → `/exam-attempts/u-1`.
Per-student collections take the student id as the first segment. The full list with access rules is
`src/modules/records/resource-registry.ts`. Singletons (`getDocument`/`saveDocument`) are
`GET|PUT /documents/:key` (`systemConfig`, `permissionMatrix`, `aiSettings`, `gamification:<id>` (read-only),
`usage:<id>` (read-only), `planSettings:<id>`, `english:<id>`, `guardianGoals:<id>`).

## Composite operations (dedicated endpoints — business rules on the server)

| Frontend service call | Endpoint |
| --- | --- |
| `authService.*` | `POST /auth/login`, `/auth/otp/request`, `/auth/register`, `/auth/otp/verify`, `/auth/otp/resend`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `POST /auth/onboarded`, `/auth/switch-role` (demo) |
| `progressService.recordAttempts` | `POST /progress/:sid/attempts` (graded server-side when `answer` is sent) |
| `progressService.logActivity / setChapterStatus / claimMission / useStreakFreeze / updateChallenge / gamification` | `POST /progress/:sid/activity`, `POST /progress/:sid/chapters/:chapterId`, `POST /progress/:sid/missions/:id/claim`, `POST /progress/:sid/streak-freeze`, `PUT /progress/:sid/challenges`, `GET /progress/:sid/gamification` |
| `examService.createAndStart / startDailyChallenge / start` | `POST /exams/custom`, `POST /exams/daily-challenge`, `POST /exams/:id/attempts` → `{ attemptId }` |
| `examService.save / submit / discard` | `PATCH /exam-attempts/:sid/:id`, `POST /exam-attempts/:sid/:id/submit`, `DELETE /exam-attempts/:sid/:id` |
| exam runner questions (no answer keys while in progress) | `GET /exam-attempts/:sid/:id/questions` |
| `tutorService.send / regenerate / report` | `POST /tutor/:sid/conversations/:id/messages` (JSON, or SSE with `Accept: text/event-stream`), `POST /tutor/:sid/messages/:id/regenerate`, `…/report` |
| `kbService.simulateQuery` | `POST /kb/query` |
| `reviewService.transition / comment / suggest / resolveSuggestion / saveQuestion` | `POST /review-items/:id/transition`, `/comments`, `/suggestions`, `/suggestions/:sid/resolve`, `POST /review-items/questions` |
| `billingService.*` | `GET /billing/me`, `POST /billing/quote`, `/billing/checkout`, `/billing/payments/:id/confirm`, `/billing/cancel`, `/billing/resume`, `/billing/downgrade`, `/billing/refunds`, `/billing/refunds/:id/decide` |
| `usageService.get / consume` | `GET /usage/:uid`, `POST /usage/:uid/consume` |
| `guardianService.*` | `POST /guardian/link-code` (student), `GET /guardian/children`, `POST /guardian/links`, `/guardian/links/:id/confirm`, `/guardian/links/:id/unlink`, `/guardian/feedback/:id/reply` |
| `notificationService.markAllRead` / admin broadcast | `POST /notifications/read-all`, `POST /notifications/broadcast` |
| `ingestionService.*` | `POST /ingestion-jobs` or `/ingestion-jobs/upload` (multipart), `/:id/retry`, `/:id/approve`, `/:id/reindex` (stages advance on the queue) |
| `securityService.sessions / revokeSession` | `GET /session-records`, `DELETE /session-records/:id` (real refresh sessions) |
| `analyticsSeries(days)` | `GET /analytics/series?days=`, `GET /analytics/overview` |
| global search | `GET /search?q=&kinds=` |
| file uploads | `POST /uploads` (multipart `file`), `GET /uploads/:id` |

## What the frontend still has to change for API mode

The frontend never calls the real API today (`NEXT_PUBLIC_USE_MOCK_API=true`). To switch:

1. Services that use `replaceAll()`/`getDocument()` for composite work should call the endpoints above in API
   mode (progress, exam save/submit, tutor, billing, review, guardian, usage). Owner-only study data
   (planner, flashcards, offline list, notes) can keep `replaceAll` → `PUT /:path/:studentId`.
2. `auth.service.ts`: keep the `challengeId` from `PendingOtp` and send it to `/auth/otp/verify`; store the
   refresh token and call `/auth/refresh` before `accessTokenExpiresAt`.
3. Use `GET /exam-attempts/:sid/:id/questions` in the exam runner instead of the full question records.
