# API Structure

Base URL (local): `http://localhost:4000/api/v1`. The version comes from URI versioning (`API_VERSION`).

- Swagger UI: `http://localhost:4000/api/docs`
- OpenAPI JSON: `http://localhost:4000/api/docs-json`

## Response format

Success:

```json
{ "success": true, "data": { }, "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 } }
```

`meta` is present only on paginated lists (a service returns `{ items, meta }`).

Error:

```json
{
  "success": false,
  "statusCode": 400,
  "code": "VALIDATION",
  "message": "Validation failed",
  "errors": { "password": ["password must be longer than or equal to 8 characters"] },
  "path": "/api/v1/auth/register",
  "timestamp": "2026-11-23T10:00:00.000Z",
  "requestId": "6d319d7c-..."
}
```

Every response carries an `x-request-id` header (the incoming value is reused if a proxy sent one).

## Status codes

| Code | When |
| --- | --- |
| 200 / 201 / 204 | OK / created / no content |
| 400 `VALIDATION` | DTO validation failed (field errors in `errors`) |
| 401 `UNAUTHORIZED` | Missing, invalid or expired token |
| 403 `FORBIDDEN` | Missing role or permission |
| 404 `NOT_FOUND` | Not found, or not yours (ownership denials look the same) |
| 409 `CONFLICT` | Unique constraint violated |
| 413 / 415 | Upload too large / wrong type |
| 429 `TOO_MANY_REQUESTS` | Rate limited (`Retry-After` header) |
| 501 `NOT_IMPLEMENTED` | Endpoint contract exists, logic not built yet |
| 503 `SERVICE_UNAVAILABLE` | Dependency or integration not configured (e.g. `AI_PROVIDER=none`) |

## Routes

Every route the frontend uses is implemented. The complete mapping (generic collections + composite operations)
is in [`frontend-integration.md`](frontend-integration.md); Swagger lists every route.

| Prefix | Module |
| --- | --- |
| `/health` | health |
| `/auth/*`, `/users/me` | auth, users |
| `/:collection[/:studentId][/:id]` (≈80 collections) | records (generic contract store) |
| `/documents/:key` | records |
| `/progress/:studentId/*` | progress |
| `/exams/*`, `/exam-attempts/:studentId/:id/*` | exams |
| `/tutor/:studentId/*`, `/kb/query`, `/ai/tutor/ask` | ai-tutor |
| `/review-items/*` | review |
| `/billing/*`, `/usage/:userId` | billing |
| `/guardian/*` | guardian |
| `/notifications/read-all`, `/notifications/broadcast` | notifications |
| `/ingestion-jobs/*`, `/uploads` | document-processing, uploads |
| `/session-records`, `/analytics/*` | admin |
| `/search` | search |

Domain errors use the frontend's codes as both `code` and `message` (`OTP_INVALID`, `COUPON_INVALID`,
`QUOTA_EXCEEDED`, `INVALID_TRANSITION`, …) with HTTP 422 (429 for quotas/rate limits).

## Conventions for new endpoints

- Plural nouns: `GET /students/:id`, `POST /exams/:id/publish` for actions.
- `@HttpCode(200)` on POST routes that don't create anything (login, actions, searches).
- Lists accept `PaginationQueryDto` (`page`, `pageSize` ≤ 100, `search`, `sortBy`, `sortOrder`).
- Protect with `@RequirePermissions(...)`, then call `AccessPolicyService` for any student-owned record.
- Never return `passwordHash`, tokens or other users' personal data. Use explicit Prisma `select`s.

## Trying protected routes locally

```bash
npm run dev:token -- student u-student-1 inst-1   # prints a 1-hour Bearer token (refuses in production)
# or sign in for real: curl -X POST localhost:4000/api/v1/auth/login -d '{"identifier":"student@shikkha.ai","password":"…"}'
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/v1/users/me
```
