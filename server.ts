/**
 * Vercel serverless entrypoint.
 * Build Fastify once per lambda instance and forward each request.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildApp } from "./apps/api/src/app.js";

const appPromise = buildApp();
let isReady = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await appPromise;
  if (!isReady) {
    await app.ready();
    isReady = true;
  }
  app.server.emit("request", req, res);
}
