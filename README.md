# JobRadar Backend

This repository contains backend services for JobRadar.

## Included

- `apps/worker` (polling + notifications)
- `apps/api` (Fastify API bootstrap service)
- `packages/db`
- `packages/shared`
- `packages/ats-adapters`

## Split notes

- Next.js API handlers from the old monorepo were moved to `apps/api/src/routes`.
- They are preserved for migration and are not yet registered as Fastify routes.
- `apps/api` currently exposes health/bootstrap endpoints and is ready for route-by-route migration.

## Local development

1. Install dependencies:
   - `npm install`
2. Start backend services:
   - `npm run dev`
3. API default port:
   - `3002`
4. Worker default port:
   - `3001`
