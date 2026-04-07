# Backend Deployment Guide (Vercel + GitHub Actions)

## 1) Connect backend repo to Vercel

1. Push `JobRadar-backend` to GitHub.
2. In Vercel, click **Add New Project** and import that repo.
3. In project settings:
   - Runtime: Node.js (auto)
   - Root directory: repo root (or your preferred backend root)
4. Save the project.

## 2) Add required Vercel environment variables

Set these in **Vercel Project -> Settings -> Environment Variables**:

- `NODE_ENV=production`
- `API_PORT=3002` (or your preferred port)
- `DATABASE_URL`
- `REDIS_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` (frontend auth URL)
- `APP_BASE_URL` (public frontend URL, if used)
- `STRIPE_SECRET_KEY` (if billing endpoints are enabled)
- `STRIPE_WEBHOOK_SECRET` (if webhook route is enabled)
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `TELEGRAM_BOT_TOKEN`
- `RESEND_API_KEY` (if email notifications are enabled)

Also add equivalent values in GitHub **Repository Secrets** for CI/CD where needed.

## 3) Configure GitHub secrets for deploy workflow

In GitHub repo settings -> **Secrets and variables -> Actions**, add:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

These are used by `.github/workflows/backend-deploy-vercel.yml`.

## 4) CI and CD behavior

- **CI** (`backend-ci.yml`):
  - installs dependencies
  - runs lint/typecheck
  - runs shared tests + adapter tests
  - runs build
- **CD** (`backend-deploy-vercel.yml`):
  - runs on push to `main` (backend-related paths) and manual dispatch
  - builds and deploys to Vercel production

## 5) Database migration step

Before first production traffic (or on schema change), run Prisma migrations against production DB:

```bash
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
```

Run this in a trusted CI step or a one-time release command.

## 6) Post-deploy smoke tests

After deploy:

1. `GET /health` returns healthy.
2. Open frontend dashboard and verify initial jobs load.
3. Verify SSE live updates (`/api/jobs/stream`) work.
4. Trigger a known new job and verify:
   - appears in live dashboard
   - notification sent only when dashboard-visible filters match.

## Important production note

This backend has two parts:
- API (`apps/api`)
- worker (`apps/worker`, BullMQ queue consumer)

The worker is a long-running process and should run on a worker-friendly host (VM/container platform). Keep Redis and worker running continuously for real-time job ingestion and notifications.
