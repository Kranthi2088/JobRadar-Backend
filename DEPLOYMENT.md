# Backend Deployment Guide (API + Worker + Redis)

This backend is a multi-service system:

- API (`apps/api`) - HTTP endpoints used by frontend
- Worker (`apps/worker`) - long-running poller/notifier process
- Redis - queue/cache/event coordination between services
- Postgres - application data

The worker is not serverless-friendly. Run API and worker as separate always-on services.

## 1) Hosting options (recommended websites)

### Option A (recommended for fast setup)

- Frontend: [Vercel](https://vercel.com/)
- API service: [Railway](https://railway.app/) or [Render](https://render.com/)
- Worker service: same as API host (Railway/Render) as a separate service
- Redis: [Upstash](https://upstash.com/) or [Redis Cloud](https://redis.io/cloud/)
- Postgres: [Neon](https://neon.tech/) / [Supabase](https://supabase.com/) / Railway Postgres

### Option B (single platform backend)

- API + Worker + Postgres on Railway or Render
- Redis from Upstash/Redis Cloud (or platform-managed Redis if available)

### Option C (more control)

- API + Worker on [Fly.io](https://fly.io/) or [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform)
- Managed Redis (Upstash/Redis Cloud)
- Managed Postgres (Neon/Supabase)

## 2) Project connection status

Your repositories are already connected to GitHub remotes:

- Backend: `https://github.com/Kranthi2088/JobRadar-Backend.git`
- Frontend: `https://github.com/Kranthi2088/JobRadar-Frontend.git`

So you can immediately import these repos into hosting providers.

## 3) Connect backend services to hosting (first deployment wiring)

Create two separate backend services from this same repo (`JobRadar-backend`):

1. **API service**
   - Root directory: repo root
   - Build command: `npm ci && npm run build:api`  
     (runs Turbo so `@jobradar/shared`, `@jobradar/ats-adapters`, `@jobradar/db`, and `@jobradar/api` all compile to `dist/` — **do not** use only `npm run build --workspace=@jobradar/api`, or workspace packages may stay on `.ts` entrypoints and Node will crash at runtime.)
   - Start command: `npm run start --workspace=@jobradar/api`
   - Health check path: `/health`
2. **Worker service**
   - Root directory: repo root
   - Build command: `npm ci && npm run build:worker`  
     (same idea: Turbo builds shared libs + worker.)
   - Start command: `npm run start --workspace=@jobradar/worker`
   - Health check path: `/health`

Provision a managed Redis instance, then set `REDIS_URL` in both API and worker.

The API and worker read **`PORT`** first (Railway/Render set this), then `API_PORT` / `WORKER_PORT`, so you usually do not need extra port variables on those hosts.

## 4) Required production environment variables

Set these for API and worker as applicable:

- `NODE_ENV=production`
- `DATABASE_URL` (API + worker)
- `REDIS_URL` (API + worker)
- `PORT` (set by Railway/Render; API/worker use this first)
- `API_PORT` / `WORKER_PORT` (optional overrides if you do not use `PORT`)
- `WEB_APP_URL` (worker redirect target)
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` (frontend public URL)
- `APP_BASE_URL` (if used)
- `STRIPE_SECRET_KEY` (optional)
- `STRIPE_WEBHOOK_SECRET` (optional)
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (if web push enabled)
- `VAPID_PRIVATE_KEY` (if web push enabled)
- `VAPID_SUBJECT` (if web push enabled)
- `TELEGRAM_BOT_TOKEN` (optional)
- `RESEND_API_KEY` (optional)

Also configure frontend `BACKEND_API_URL` to point to the deployed API service.

## 5) GitHub Actions and CI/CD

Existing workflows:

- **CI** (`.github/workflows/backend-ci.yml`)
  - install dependencies
  - lint/typecheck
  - tests
  - build
- **CD** (`.github/workflows/backend-deploy-vercel.yml`)
  - Vercel deployment workflow

Note: Vercel is better suited for frontend/serverless patterns. For this backend design (especially the worker), Railway/Render/Fly are usually a better production fit.

## 6) Database migration step

Before first production traffic (and for each schema change), run:

```bash
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
```

Run in a trusted CI release job or one-time deploy command.

## 7) Post-deploy smoke tests

After deployment:

1. API `GET /health` returns healthy.
2. Worker `GET /health` returns healthy and can access Redis + DB.
3. Frontend loads dashboard using deployed API URL.
4. SSE endpoint (`/api/jobs/stream`) receives events.
5. Trigger a known new job and confirm:
   - dashboard update appears
   - notification behavior matches watchlist filters.
