import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { startPoller } from "./poller.js";
import { startNotifier } from "./notifier.js";
import { redis } from "./redis.js";
import { prisma } from "./prisma.js";

const PORT = parseInt(process.env.PORT || process.env.WORKER_PORT || "3001", 10);
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

app.get("/health/db-test", async (_req, reply) => {
  const rawUrl = process.env.DATABASE_URL ?? "(not set)";
  const maskedUrl = rawUrl.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");

  // ── 1. Prisma query test ──────────────────────────────────────────────────
  let prismaOk = false;
  let prismaResult: unknown = null;
  let prismaError: Record<string, unknown> | null = null;

  try {
    // $queryRaw returns the raw rows; SELECT 1 is the lightest possible query
    prismaResult = await prisma.$queryRawUnsafe("SELECT 1 AS ok");
    prismaOk = true;
  } catch (err: any) {
    const code: string | undefined = err?.code;
    const msg: string = err?.message ?? String(err);

    let hint = "Unknown error";
    if (code === "P1001" || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("Can't reach database")) {
      hint = "Host unreachable — check DATABASE_URL hostname/port and network/firewall rules";
    } else if (code === "P1002" || msg.includes("ETIMEDOUT") || msg.includes("Timed out fetching")) {
      hint = "Connection timed out — host is reachable but not responding; check firewall, VPC, or Supabase connection limits";
    } else if (code === "P1008") {
      hint = "Operations timed out — database is overloaded or connection pool exhausted";
    } else if (code === "P1017") {
      hint = "Server closed the connection — check Supabase connection limits or pgBouncer settings";
    } else if (code === "P2024") {
      hint = "Connection pool timeout — all connections in use; consider reducing pool size or increasing timeout";
    } else if (msg.includes("SSL") || msg.includes("certificate")) {
      hint = "SSL/TLS handshake failed — verify sslmode=require is set and the server certificate is trusted";
    } else if (msg.includes("authentication") || msg.includes("password")) {
      hint = "Authentication failed — check DB username/password in DATABASE_URL";
    }

    prismaError = {
      message: msg,
      code: code ?? null,
      hint,
      stack: err?.stack ?? null,
      meta: err?.meta ?? null,
    };
  }

  // ── 2. Raw TCP / TLS probe via Node's net/tls modules ────────────────────
  let tcpProbe: Record<string, unknown> = { skipped: true };

  try {
    // Parse host + port from DATABASE_URL so we can test the raw socket
    const urlToParse = rawUrl !== "(not set)" ? rawUrl : null;
    if (urlToParse) {
      const parsed = new URL(urlToParse);
      const host = parsed.hostname;
      const port = parseInt(parsed.port || "5432", 10);
      const useSSL = parsed.searchParams.get("sslmode") !== "disable";

      if (useSSL) {
        const tls = await import("tls");
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            tcpProbe = { ok: false, host, port, ssl: true, error: "TCP connect timed out after 5 s" };
            resolve();
          }, 5000);
          const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
            clearTimeout(timeout);
            tcpProbe = {
              ok: true,
              host,
              port,
              ssl: true,
              authorized: socket.authorized,
              authorizationError: socket.authorizationError ?? null,
              peerCertSubject: socket.getPeerCertificate()?.subject ?? null,
            };
            socket.destroy();
            resolve();
          });
          socket.on("error", (e: Error) => {
            clearTimeout(timeout);
            tcpProbe = { ok: false, host, port, ssl: true, error: e.message };
            resolve();
          });
        });
      } else {
        const net = await import("net");
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            tcpProbe = { ok: false, host, port, ssl: false, error: "TCP connect timed out after 5 s" };
            resolve();
          }, 5000);
          const socket = net.connect({ host, port }, () => {
            clearTimeout(timeout);
            tcpProbe = { ok: true, host, port, ssl: false };
            socket.destroy();
            resolve();
          });
          socket.on("error", (e: Error) => {
            clearTimeout(timeout);
            tcpProbe = { ok: false, host, port, ssl: false, error: e.message };
            resolve();
          });
        });
      }
    }
  } catch (probeErr: any) {
    tcpProbe = { ok: false, error: probeErr?.message ?? String(probeErr) };
  }

  const status = prismaOk ? 200 : 503;
  reply.code(status);

  return {
    prisma: {
      ok: prismaOk,
      result: prismaResult,
      error: prismaError,
    },
    tcpProbe,
    databaseUrl: maskedUrl,
    uptime: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
});

/** If someone opens the worker port in a browser, send them to the Next.js app. */
app.setNotFoundHandler((req, reply) => {
  if (req.method === "GET" && req.url !== "/health") {
    // Fastify v5: redirect(url, statusCode?)
    const path = req.url === "/" ? "" : req.url;
    return reply.redirect(WEB_APP_URL + path, 302);
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
