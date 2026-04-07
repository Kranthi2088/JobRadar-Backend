/**
 * Vercel Fastify entrypoint (repo root). See https://vercel.com/docs/frameworks/backend/fastify
 * Railway / local dev use `apps/api` → `npm run start --workspace=@jobradar/api` instead.
 */
import { buildApp } from "./apps/api/src/app.js";

const app = await buildApp();
const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`Backend API listening on ${port}`);
