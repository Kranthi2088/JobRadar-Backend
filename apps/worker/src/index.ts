import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { startPoller } from "./poller";
import { startNotifier } from "./notifier";
import { redis } from "./redis";
import { prisma } from "./prisma";

const PORT = parseInt(process.env.WORKER_PORT || "3001", 10);
const startTime = Date.now();

/** Next.js app URL — worker is API-only; browsers should use this port for the UI. */
const WEB_APP_URL =
  process.env.WEB_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty" }
        : undefined,
  },
});

await app.register(cors, { origin: true });

app.get("/health", async (_req, reply) => {
  try {
    const activeWatchers = await prisma.watchlist.count();
    const lastPollRaw = await redis.get("last-poll-at");
    const lastPollAt = lastPollRaw ? new Date(lastPollRaw) : null;

    return {
      status: "healthy" as const,
      activeWatchers,
      lastPollAt,
      uptime: Date.now() - startTime,
      version: "0.1.0",
      webApp: WEB_APP_URL,
    };
  } catch (err: any) {
    reply.code(503);
    return {
      status: "degraded" as const,
      error: err?.message ?? "Database or Redis unavailable",
      webApp: WEB_APP_URL,
      hint: "Open the UI at webApp (port 3000), not this worker port",
    };
  }
});

/** If someone opens the worker port in a browser, send them to the Next.js app. */
app.setNotFoundHandler((req, reply) => {
  if (req.method === "GET" && req.url !== "/health") {
    return reply.redirect(302, WEB_APP_URL + (req.url === "/" ? "" : ""));
  }
  return reply.code(404).send({ error: "Not found", webApp: WEB_APP_URL });
});

async function main() {
  try {
    app.log.info("Starting JobRadar worker (API only — use %s for the web UI)", WEB_APP_URL);

    await app.listen({ port: PORT, host: "0.0.0.0" });
    app.log.info(`Worker API listening on port ${PORT}`);
    app.log.info(
      { pollTickMs: process.env.POLL_SCHEDULER_TICK_MS || "10000" },
      "Jobs are fetched on a schedule when at least one user has a watchlist entry; check logs for “Poller” and multi-source health."
    );

    try {
      await startPoller(app.log);
      app.log.info("Polling engine started");
    } catch (err: any) {
      app.log.error({ err: err?.message }, "Poller failed to start (continuing)");
    }

    try {
      await startNotifier(app.log);
      app.log.info("Notification worker started");
    } catch (err: any) {
      app.log.error({ err: err?.message }, "Notifier failed to start (continuing)");
    }
  } catch (err) {
    app.log.error(err, "Failed to bind worker HTTP server");
    process.exit(1);
  }
}

const shutdown = async () => {
  app.log.info("Shutting down...");
  await app.close();
  try {
    await redis.quit();
  } catch {
    /* ignore */
  }
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main();
