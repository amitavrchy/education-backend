# ShikkhaAI — Backend

REST API foundation for ShikkhaAI, an AI-powered learning platform for SSC/HSC students, teachers,
parents and institutions in Bangladesh.

**Stack:** Node.js 24 · NestJS 12 (ESM) · TypeScript 6 · PostgreSQL 17 · Prisma 7 · Redis 7 · BullMQ ·
JWT · Swagger · class-validator · pino · Docker Compose · Vitest · ESLint

> This is the initialization phase. Infrastructure, security and module boundaries are in place;
> most business features are skeletons. See [docs/module-map.md](docs/module-map.md) for exact status.

## Quick start

Requirements: Node.js ≥ 20.19 (24 recommended) and Docker Desktop.

```bash
# 1. Environment
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
#    then set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (≥ 32 chars each)

# 2. Infrastructure (PostgreSQL + Redis)
npm run docker:up               # docker compose up -d
docker compose ps               # wait until both are "healthy"

# 3. Dependencies, database
npm install                     # also runs `prisma generate`
npm run db:migrate              # creates and applies migrations (first run: name it "init")
npm run db:seed:reset           # the frontend demo data (see docs/frontend-integration.md)

# 4. Run
npm run start:dev               # http://localhost:4000/api/v1
```

| URL | What |
| --- | --- |
| http://localhost:4000/api/docs | Swagger UI |
| http://localhost:4000/api/docs-json | OpenAPI JSON |
| http://localhost:4000/api/v1/health | Liveness |
| http://localhost:4000/api/v1/health/ready | Readiness (PostgreSQL + Redis) |

Stop the infrastructure with `npm run docker:down` (keeps data). Use `docker compose down -v` to wipe all local data.

## Scripts

| Script | Purpose |
| --- | --- |
| `start:dev` / `start:debug` / `start:prod` | Run (watch / debug / compiled `dist/main.js`) |
| `build` | Compile to `dist/` |
| `typecheck` · `lint` · `format` | `tsc --noEmit` · ESLint · Prettier |
| `test` · `test:e2e` · `test:cov` | Vitest unit (`test/unit`) · e2e (`test/e2e`) · coverage |
| `check` | typecheck + lint + unit tests + build |
| `prisma:generate` · `prisma:studio` | Regenerate client · DB browser |
| `db:migrate` · `db:deploy` · `db:seed` · `db:reset` | Migrations (dev / production) · seed · reset |
| `docker:up` · `docker:down` · `docker:logs` | Local PostgreSQL + Redis |
| `dev:token -- <ROLE>` | Mint a 1-hour dev access token for a role (refuses in production) |

## Project structure

```
src/
├── main.ts / app.module.ts / swagger.ts   bootstrap, root wiring, OpenAPI
├── config/          env schema (zod) + typed config namespaces
├── common/          guards, decorators, filters, interceptors, pipes, dto, enums, constants, utils
├── database/        prisma/ (PrismaModule, PrismaService) · seeds/
├── infrastructure/  redis · queues · storage · events · logging · rate-limit
├── integrations/    ai-providers · speech-services · ocr-services · file-storage · email · sms · payment-providers
├── modules/         44 business modules + domain.module.ts
├── health/          liveness + readiness
└── generated/       Prisma client (git-ignored, generated)
prisma/              schema.prisma · migrations/ · seed.ts
test/                unit/ · integration/ · e2e/
docs/                architecture.md · api-structure.md · module-map.md
docker/              postgres init SQL · redis.conf
scripts/             generate-dev-token.ts
```

## Environment

Full list with comments in [.env.example](.env.example). The values are validated at boot by `src/config/configuration.ts`.

- **Required:** `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
- **Everything else** has a safe development default.
- **Optional integrations** (`AI_*`, `STORAGE_ACCESS_KEY`, `EMAIL_PROVIDER`, `SMS_PROVIDER`, `PAYMENT_PROVIDER`) never block startup.

## Notes

- **ESM project:** relative imports end in `.js`, and there's no `__dirname` (use `import.meta.dirname`). Never `import type` a class that Nest injects.
- **Lazy connections:** PostgreSQL and Redis connect lazily, so the API boots even if they are down. `/health/ready` tells you the truth.
- **Windows:** run `prisma migrate` from PowerShell or cmd. In Git Bash the schema engine fails with `spawn UNKNOWN`.
- **Workers:** set `QUEUE_WORKERS_ENABLED=false` on instances that should only enqueue jobs.
- **Production:** run `npm run db:deploy` as a release step, set `NODE_ENV=production`, use distinct strong JWT secrets, set `SWAGGER_ENABLED=false` (or protect the docs), and set `TRUST_PROXY=true` behind a load balancer.

More: [docs/architecture.md](docs/architecture.md) · [docs/api-structure.md](docs/api-structure.md) · [docs/module-map.md](docs/module-map.md)
