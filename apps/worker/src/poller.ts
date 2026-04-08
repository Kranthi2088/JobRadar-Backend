import {
  fetchJobsFromAllSources,
  computeListingKey,
} from "@jobradar/ats-adapters";
import {
  REDIS_KEYS,
  SEEN_JOB_TTL_SECONDS,
  CIRCUIT_BREAKER,
  shouldPersistFetchedJob,
} from "@jobradar/shared";
import type { FastifyBaseLogger } from "fastify";
import type { NormalizedJob } from "@jobradar/shared";
import { redis } from "./redis.js";
import { jobQueue } from "./queue.js";
import { prisma } from "./prisma.js";

const POLL_LAST_KEY = (slug: string) => `poll:last-at:${slug}`;
const POLL_FAIL_KEY = (slug: string) => `poll:failures:${slug}`;

const SCHEDULER_TICK_MS = parseInt(
  process.env.POLL_SCHEDULER_TICK_MS || "10000",
  10
);

const MAX_POLLS_PER_TICK = Math.max(
  1,
  parseInt(process.env.MAX_POLLS_PER_TICK || "1", 10)
);

const DEFAULT_INTERVAL_SEC = 300;
const POLL_STATE_TTL_SECONDS = Math.max(
  60,
  parseInt(process.env.REDIS_POLL_STATE_TTL_SECONDS || "21600", 10)
);

let lastSchedulerDbErrorLog = 0;
let loggedEmptyWatchlists = false;

export async function startPoller(logger: FastifyBaseLogger) {
  logger.info(
    {
      SCHEDULER_TICK_MS,
      MAX_POLLS_PER_TICK,
      mode: "watchlist-only-throttled",
    },
    "Poller: only companies on at least one user watchlist; max N ATS requests per tick"
  );

  setInterval(() => {
    void runSchedulerTick(logger);
  }, SCHEDULER_TICK_MS);

  void runSchedulerTick(logger);

  setInterval(async () => {
    await redis.set(
      "last-poll-at",
      new Date().toISOString(),
      "EX",
      POLL_STATE_TTL_SECONDS
    );
  }, 30_000);
}

type WatchedCompany = {
  id: string;
  slug: string;
  preferredSourceId: string | null;
  sources: Array<{
    id: string;
    atsType: string;
    endpoint: string;
    priority: number;
  }>;
  intervalSeconds: number;
};

async function runSchedulerTick(logger: FastifyBaseLogger) {
  try {
    const watched = await loadWatchedCompanies();
    if (watched.length === 0) {
      if (!loggedEmptyWatchlists) {
        loggedEmptyWatchlists = true;
        logger.info(
          "Poller: no companies on any watchlist — nothing to fetch. Add a watch in the app or the worker will stay idle."
        );
      }
      return;
    }
    loggedEmptyWatchlists = false;

    const now = Date.now();
    type DueEntry = { company: WatchedCompany; lastAt: number };
    const candidates: DueEntry[] = [];

    for (const company of watched) {
      const intervalMs = Math.max(60_000, company.intervalSeconds * 1000);
      const lastRaw = await redis.get(POLL_LAST_KEY(company.slug));
      const lastAt = lastRaw ? parseInt(lastRaw, 10) : 0;
      if (!lastAt || now - lastAt >= intervalMs) {
        candidates.push({ company, lastAt });
      }
    }

    candidates.sort((a, b) => a.lastAt - b.lastAt);

    const batch = candidates.slice(0, MAX_POLLS_PER_TICK);
    for (const { company } of batch) {
      await executePoll(company, logger);
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const code: string | undefined = err?.code;
    const isDb =
      msg.includes("Can't reach database") ||
      msg.includes("connection pool") ||
      msg.includes("Timed out fetching") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("SSL") ||
      msg.includes("certificate") ||
      code === "P1001" ||
      code === "P1002" ||
      code === "P1008" ||
      code === "P1017" ||
      code === "P2024";

    if (isDb) {
      const now = Date.now();
      if (now - lastSchedulerDbErrorLog > 60_000) {
        lastSchedulerDbErrorLog = now;

        // Mask credentials in the DATABASE_URL for safe logging
        const rawUrl = process.env.DATABASE_URL ?? "(not set)";
        const maskedUrl = rawUrl.replace(
          /\/\/([^:]+):([^@]+)@/,
          "//$1:***@"
        );

        // Classify the failure for faster diagnosis
        let hint = "Unknown DB connectivity issue";
        if (code === "P1001" || msg.includes("Can't reach database") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
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

        logger.warn(
          {
            prismaCode: code ?? "(none)",
            errorMessage: msg,
            stack: err?.stack ?? "(no stack)",
            databaseUrl: maskedUrl,
            hint,
            ...(err?.meta ? { prismaMeta: err.meta } : {}),
          },
          "Database unreachable — poller idle"
        );
      }
      return;
    }
    logger.error({ err: msg, code, stack: err?.stack }, "Scheduler tick failed");
  }
}

async function loadWatchedCompanies(): Promise<WatchedCompany[]> {
  const grouped = await prisma.watchlist.groupBy({
    by: ["companyId"],
    _max: { pollingIntervalSeconds: true },
  });

  if (grouped.length === 0) return [];

  const ids = grouped.map((g: { companyId: string }) => g.companyId);
  const companies = await prisma.company.findMany({
    where: { id: { in: ids }, isActive: true },
    include: {
      sources: {
        where: { isActive: true },
        orderBy: { priority: "asc" },
      },
    },
  });

  const intervalByCompany = new Map<string, number>(
    grouped.map(
      (g: {
        companyId: string;
        _max: { pollingIntervalSeconds: number | null };
      }) => [
        g.companyId,
        g._max.pollingIntervalSeconds ?? DEFAULT_INTERVAL_SEC,
      ]
    )
  );

  return companies.map((c: (typeof companies)[number]) => {
    const raw = intervalByCompany.get(c.id) ?? DEFAULT_INTERVAL_SEC;
    const intervalSeconds = Math.max(60, Math.min(86_400, raw));
    return {
      id: c.id,
      slug: c.slug,
      preferredSourceId: c.preferredSourceId,
      sources: c.sources.map((s: (typeof c.sources)[number]) => ({
        id: s.id,
        atsType: s.atsType,
        endpoint: s.endpoint,
        priority: s.priority,
      })),
      intervalSeconds,
    };
  });
}

async function executePoll(
  company: WatchedCompany,
  logger: FastifyBaseLogger
): Promise<void> {
  const circuitOpen = await isCircuitOpen(company.slug);
  if (circuitOpen) {
    logger.warn({ company: company.slug }, "Circuit breaker open, skipping poll");
    return;
  }

  if (company.sources.length === 0) {
    logger.warn(
      { company: company.slug },
      "No active CompanySource rows — add sources in DB or re-seed"
    );
    return;
  }

  const start = Date.now();

  try {
    const { jobs, perSource, primarySourceId } = await fetchJobsFromAllSources({
      slug: company.slug,
      sources: company.sources,
      preferredSourceId: company.preferredSourceId,
    });

    for (const r of perSource) {
      await prisma.companySource
        .update({
          where: { id: r.sourceId },
          data: {
            lastSuccessAt: r.ok ? new Date() : undefined,
            lastError: r.ok ? null : (r.error ?? "error"),
          },
        })
        .catch((err: unknown) => {
          logger.warn({ err, sourceId: r.sourceId }, "Could not update CompanySource health");
        });
    }

    if (jobs.length === 0) {
      const latencyMs = Date.now() - start;
      logger.info({
        company: company.slug,
        totalJobs: 0,
        latencyMs,
      });
      await redis.set(
        POLL_LAST_KEY(company.slug),
        String(Date.now()),
        "EX",
        POLL_STATE_TTL_SECONDS
      );
      await redis.del(POLL_FAIL_KEY(company.slug));
      return;
    }

    if (primarySourceId) {
      await prisma.company
        .update({
          where: { id: company.id },
          data: { preferredSourceId: primarySourceId },
        })
        .catch((err: unknown) => {
          logger.warn({ err, company: company.slug }, "Could not save preferredSourceId");
        });
    }

    const jobsWithKeys = jobs
      .filter(shouldPersistFetchedJob)
      .map((j: NormalizedJob) => ({
        ...j,
        listingKey: j.listingKey ?? computeListingKey(j.url),
      }));

    const newJobs = await deduplicateJobs(company.slug, jobsWithKeys);
    await upsertAllJobsToDb(company.id, jobsWithKeys, logger);
    if (newJobs.length > 0) {
      await enqueueNotificationsForNewJobs(company.id, company.slug, newJobs, logger);
    }

    const latencyMs = Date.now() - start;
    logger.info({
      company: company.slug,
      totalJobs: jobs.length,
      newJobs: newJobs.length,
      latencyMs,
    });

    await redis.set(
      POLL_LAST_KEY(company.slug),
      String(Date.now()),
      "EX",
      POLL_STATE_TTL_SECONDS
    );
    await redis.del(POLL_FAIL_KEY(company.slug));
  } catch (error: any) {
    await redis.set(
      POLL_LAST_KEY(company.slug),
      String(Date.now()),
      "EX",
      POLL_STATE_TTL_SECONDS
    );

    const fails = await redis.incr(POLL_FAIL_KEY(company.slug));
    await redis.expire(POLL_FAIL_KEY(company.slug), POLL_STATE_TTL_SECONDS);

    if (fails >= CIRCUIT_BREAKER.FAILURE_THRESHOLD) {
      await openCircuitBreaker(company.slug);
      logger.error(
        { company: company.slug, failures: fails },
        "Circuit breaker opened (watchlist poll)"
      );
    }

    const status = error.status;
    if (status === 429 || status === 503) {
      logger.warn({ company: company.slug, status }, "Rate limited / unavailable");
    }

    logger.error({ company: company.slug, err: error.message }, "Poll failed");
  }
}

async function deduplicateJobs(
  companySlug: string,
  jobs: NormalizedJob[]
): Promise<NormalizedJob[]> {
  if (jobs.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const job of jobs) {
    const key = job.listingKey ?? computeListingKey(job.url);
    pipeline.exists(REDIS_KEYS.seenJob(companySlug, key));
  }

  const results = await pipeline.exec();
  const newJobs: NormalizedJob[] = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const lk = job.listingKey ?? computeListingKey(job.url);
    const exists = results?.[i]?.[1] as number;
    if (!exists) {
      newJobs.push(job);
      await redis.set(
        REDIS_KEYS.seenJob(companySlug, lk),
        JSON.stringify({
          detectedAt: job.detectedAt.toISOString(),
          title: job.title,
          url: job.url,
        }),
        "EX",
        SEEN_JOB_TTL_SECONDS
      );
    }
  }

  return newJobs;
}

/** Persist full fetched catalog — feed shows all roles that match the user’s watchlist filters. */
async function upsertAllJobsToDb(
  companyId: string,
  jobs: NormalizedJob[],
  logger: FastifyBaseLogger
) {
  for (const job of jobs) {
    const listingKey = job.listingKey ?? computeListingKey(job.url);
    try {
      await prisma.job.upsert({
        where: {
          companyId_listingKey: {
            companyId,
            listingKey,
          },
        },
        create: {
          companyId,
          companySourceId: job.companySourceId ?? null,
          listingKey,
          externalId: job.id,
          title: job.title,
          url: job.url,
          team: job.team,
          location: job.location,
          seniority: job.seniority,
          postedAt: job.postedAt ?? null,
          detectedAt: job.detectedAt,
        },
        update: {
          companySourceId: job.companySourceId ?? null,
          externalId: job.id,
          title: job.title,
          url: job.url,
          team: job.team,
          location: job.location,
          seniority: job.seniority,
          ...(job.postedAt ? { postedAt: job.postedAt } : {}),
        },
      });
    } catch (err: any) {
      logger.error({ listingKey, err: err.message }, "Failed to persist job");
    }
  }
}

/** Web push / email only for jobs we have not notified about yet (Redis dedup). */
async function enqueueNotificationsForNewJobs(
  companyId: string,
  companySlug: string,
  newJobs: NormalizedJob[],
  logger: FastifyBaseLogger
) {
  await jobQueue.addBulk(
    newJobs.map((job) => ({
      name: "new-job",
      data: {
        companySlug,
        companyId,
        job: {
          ...job,
          listingKey: job.listingKey ?? computeListingKey(job.url),
          detectedAt: job.detectedAt.toISOString(),
          postedAt: job.postedAt?.toISOString(),
        },
      },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    }))
  );

  logger.info({ companySlug, count: newJobs.length }, "Enqueued new jobs for notification");
}

async function isCircuitOpen(companySlug: string): Promise<boolean> {
  const key = REDIS_KEYS.companyCircuitBreaker(companySlug);
  const value = await redis.get(key);
  return value === "open";
}

async function openCircuitBreaker(companySlug: string) {
  const key = REDIS_KEYS.companyCircuitBreaker(companySlug);
  const ttlSeconds = Math.floor(CIRCUIT_BREAKER.RECOVERY_TIMEOUT_MS / 1000);
  await redis.set(key, "open", "EX", ttlSeconds);
}
