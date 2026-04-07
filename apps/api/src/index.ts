import { config } from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import Stripe from "stripe";
import { getToken } from "next-auth/jwt";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import {
  DASHBOARD_VISIBILITY_WINDOW_MS,
  isUnitedStatesJobLocationOrTitle,
  roleKeywordTokens,
  titleMatchesRoleKeyword,
} from "@jobradar/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");

config({ path: resolve(root, "docker/compose.override.env") });
config({ path: resolve(root, ".env") });
config({ path: resolve(root, ".env.local"), override: true });

const PORT = parseInt(process.env.API_PORT || "3002", 10);
const prisma = new PrismaClient();
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret
  ? new Stripe(stripeSecret, { apiVersion: "2025-02-24.acacia" })
  : null;

let redisClient: Redis | null = null;
type PlanType = "free" | "pro" | "teams";
const PLAN_LIMITS: Record<PlanType, { maxCompanies: number }> = {
  free: { maxCompanies: 5 },
  pro: { maxCompanies: Number.POSITIVE_INFINITY },
  teams: { maxCompanies: Number.POSITIVE_INFINITY },
};
function jobMatchesAnyWatchlist(
  job: { companyId: string; title: string; location: string | null; seniority: string | null },
  watchlists: Array<{
    companyId: string;
    roleKeyword: string;
    locationFilter: string | null;
    seniorityFilter: string | null;
  }>
) {
  return watchlists.some((wl) => {
    if (job.companyId !== wl.companyId) return false;
    if (!titleMatchesRoleKeyword(job.title, wl.roleKeyword)) return false;
    const loc = wl.locationFilter?.trim();
    if (loc) {
      const hay = `${job.location || ""} ${job.title || ""}`.toLowerCase();
      if (!hay.includes(loc.toLowerCase())) return false;
    }
    const sen = wl.seniorityFilter?.trim();
    if (sen) {
      const s = (job.seniority || "").toLowerCase();
      const t = job.title.toLowerCase();
      const needle = sen.toLowerCase();
      if (!s.includes(needle) && !t.includes(needle)) return false;
    }
    return true;
  });
}
function getRedis(): Redis | null {
  try {
    if (!redisClient) {
      redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
    }
    return redisClient;
  } catch {
    return null;
  }
}

async function clearWorkerJobCache(): Promise<{ deleted: number }> {
  const redis = getRedis();
  if (!redis) return { deleted: 0 };
  const patterns = ["seen:*", "poll:last-at:*", "poll:failures:*", "circuit:*"];
  let deleted = 0;
  for (const pattern of patterns) {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", "200");
      cursor = next;
      if (keys.length) deleted += await redis.del(...keys);
    } while (cursor !== "0");
  }
  return { deleted };
}

function recentJobVisibilityWhere(windowMs: number = 24 * 60 * 60 * 1000) {
  const after = new Date(Date.now() - windowMs);
  return { OR: [{ postedAt: { gte: after } }, { detectedAt: { gte: after } }] };
}

function isDashboardVisibleJob(job: {
  postedAt: Date | null;
  detectedAt: Date;
  location: string | null;
  title: string;
}) {
  const ts = (job.postedAt ?? job.detectedAt).getTime();
  if (ts < Date.now() - DASHBOARD_VISIBILITY_WINDOW_MS) return false;
  return isUnitedStatesJobLocationOrTitle(job.location, job.title);
}

function buildJobWhereFromWatchlists(
  watchlists: Array<{
    companyId: string;
    roleKeyword: string;
    locationFilter: string | null;
    seniorityFilter: string | null;
  }>,
  windowMs?: number
) {
  if (watchlists.length === 0) return { id: { in: [] as string[] } };
  return {
    AND: [
      {
        OR: watchlists.map((wl) => {
          const parts: any[] = [{ companyId: wl.companyId }];
          for (const t of roleKeywordTokens(wl.roleKeyword)) {
            parts.push({ title: { contains: t, mode: "insensitive" as const } });
          }
          const loc = wl.locationFilter?.trim();
          if (loc) {
            parts.push({
              OR: [
                { location: { contains: loc, mode: "insensitive" as const } },
                { title: { contains: loc, mode: "insensitive" as const } },
              ],
            });
          }
          const sen = wl.seniorityFilter?.trim();
          if (sen) {
            parts.push({
              OR: [
                { seniority: { contains: sen, mode: "insensitive" as const } },
                { title: { contains: sen, mode: "insensitive" as const } },
              ],
            });
          }
          return { AND: parts };
        }),
      },
      recentJobVisibilityWhere(windowMs),
    ],
  };
}

async function requireUser(req: any) {
  // Local dev escape hatch: skip NextAuth cookie verification entirely.
  // This is intentionally only for local development (SKIP_AUTH=true).
  if (process.env.SKIP_AUTH === "true") {
    const email = "dev@localhost.local";
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: "Local Dev",
        emailVerified: new Date(),
      },
      update: {},
      select: { id: true, email: true, plan: true },
    });
    return user;
  }

  const token = await getToken({
    req: { headers: { cookie: req.headers.cookie || "" } } as any,
    secret: process.env.NEXTAUTH_SECRET,
  });
  if (!token?.sub) return null;
  const user = await prisma.user.findUnique({
    where: { id: token.sub },
    select: { id: true, email: true, plan: true },
  });
  return user;
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
  },
});

await app.register(cors, { origin: true, credentials: true });

app.get("/health", async () => ({ status: "healthy" as const, service: "api" }));

app.get("/api/companies", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const q = ((req.query as any)?.q || "").toString();
  const companies = await prisma.company.findMany({
    where: {
      isActive: true,
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] }
        : {}),
    },
    take: 20,
    orderBy: { name: "asc" },
  });
  return companies;
});

app.get("/api/watchlist", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const watchlists = await prisma.watchlist.findMany({
    where: { userId: user.id },
    include: { company: true },
    orderBy: { createdAt: "desc" },
  });
  return watchlists;
});

app.post("/api/watchlist", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const body = (req.body || {}) as any;
  const { companyId, roleKeyword, locationFilter, seniorityFilter, pollingIntervalSeconds } = body;
  if (!companyId || !roleKeyword) return reply.code(400).send({ error: "companyId and roleKeyword are required" });
  let intervalSec = Number(pollingIntervalSeconds);
  if (!Number.isFinite(intervalSec) || intervalSec < 60) intervalSec = 300;
  if (intervalSec > 86_400) intervalSec = 86_400;
  const plan = (user.plan || "free") as PlanType;
  const currentCount = await prisma.watchlist.count({ where: { userId: user.id } });
  const limit = PLAN_LIMITS[plan].maxCompanies;
  if (currentCount >= limit) {
    return reply.code(403).send({ error: `Free plan is limited to ${limit} companies. Upgrade to Pro for unlimited.`, upgrade: true });
  }
  const watchlist = await prisma.watchlist.create({
    data: {
      userId: user.id,
      companyId,
      roleKeyword,
      pollingIntervalSeconds: intervalSec,
      locationFilter: typeof locationFilter === "string" && locationFilter.trim() ? locationFilter.trim() : null,
      seniorityFilter: typeof seniorityFilter === "string" && seniorityFilter.trim() ? seniorityFilter.trim() : null,
    },
    include: { company: true },
  });
  return reply.code(201).send(watchlist);
});

app.patch("/api/watchlist/:id", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const id = (req.params as any).id as string;
  const body = (req.body || {}) as any;
  const existing = await prisma.watchlist.findFirst({ where: { id, userId: user.id } });
  if (!existing) return reply.code(404).send({ error: "Not found" });
  let intervalSec = Number(body.pollingIntervalSeconds);
  if (!Number.isFinite(intervalSec) || intervalSec < 60) intervalSec = existing.pollingIntervalSeconds;
  if (intervalSec > 86_400) intervalSec = 86_400;
  const updated = await prisma.watchlist.update({
    where: { id },
    data: {
      pollingIntervalSeconds: intervalSec,
      ...(body.locationFilter !== undefined
        ? { locationFilter: typeof body.locationFilter === "string" && body.locationFilter.trim() ? body.locationFilter.trim() : null }
        : {}),
      ...(body.seniorityFilter !== undefined
        ? { seniorityFilter: typeof body.seniorityFilter === "string" && body.seniorityFilter.trim() ? body.seniorityFilter.trim() : null }
        : {}),
    },
    include: { company: true },
  });
  return updated;
});

app.delete("/api/watchlist/:id", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const id = (req.params as any).id as string;
  const watchlist = await prisma.watchlist.findFirst({ where: { id, userId: user.id } });
  if (!watchlist) return reply.code(404).send({ error: "Not found" });
  await prisma.watchlist.delete({ where: { id } });
  return { success: true };
});

app.get("/api/jobs", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const query = req.query as any;
  const page = parseInt(query?.page || "1", 10);
  const limit = Math.min(parseInt(query?.limit || "50", 10), 100);
  const company = query?.company || null;
  const keyword = query?.keyword || null;
  const timelineHours = Math.min(
    Math.max(parseInt(query?.timeline || "24", 10) || 24, 1),
    168
  );
  const timelineMs = timelineHours * 60 * 60 * 1000;
  const watchlists = await prisma.watchlist.findMany({
    where: { userId: user.id },
    select: { companyId: true, roleKeyword: true, locationFilter: true, seniorityFilter: true },
  });
  const allowedCompanyIds = new Set(
    watchlists.map((w: { companyId: string }) => w.companyId)
  );
  const baseWhere = buildJobWhereFromWatchlists(watchlists, timelineMs);
  if (company && !allowedCompanyIds.has(company)) {
    return { jobs: [], pagination: { page, limit, total: 0, totalPages: 0 } };
  }
  const where = {
    AND: [
      baseWhere,
      ...(company ? [{ companyId: company }] : []),
      ...(keyword ? [{ title: { contains: keyword, mode: "insensitive" as const } }] : []),
    ],
  };
  const jobs = await prisma.job.findMany({
    where,
    include: { company: { select: { name: true, slug: true, logoUrl: true } } },
    orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { detectedAt: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
  });
  const total = await prisma.job.count({ where });
  return { jobs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
});

app.post("/api/jobs/:id/applied", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const id = (req.params as any).id as string;
  const application = await prisma.application.upsert({
    where: { userId_jobId: { userId: user.id, jobId: id } },
    create: { userId: user.id, jobId: id },
    update: {},
  });
  return application;
});

app.post("/api/jobs/poll", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const companyId = ((req.body as any)?.companyId || "").trim();
  if (!companyId) return reply.code(400).send({ error: "companyId is required" });
  const company = await prisma.company.findFirst({ where: { id: companyId, isActive: true } });
  if (!company) return reply.code(404).send({ error: "Company not found" });
  return reply.code(501).send({
    error: "Manual polling is not migrated yet",
    company: { slug: company.slug, name: company.name },
  });
});

app.get("/api/jobs/stream", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send("Unauthorized");
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send("connected", { message: "SSE connected", userId: user.id });
  const watchlists = await prisma.watchlist.findMany({
    where: { userId: user.id },
    select: { companyId: true, roleKeyword: true, locationFilter: true, seniorityFilter: true },
  });
  const companyIds = watchlists.map((w: { companyId: string }) => w.companyId);
  let lastCheck = new Date();
  const sentJobIds = new Set<string>();
  const pruneSentCache = () => {
    if (sentJobIds.size > 2000) {
      sentJobIds.clear();
    }
  };

  // Keep SSE connection warm across proxies/load balancers.
  const heartbeat = setInterval(() => {
    send("heartbeat", { ts: new Date().toISOString() });
  }, 20_000);

  const interval = setInterval(async () => {
    try {
      // Small overlap to avoid misses between db read and cursor update.
      const overlapMs = 1500;
      const since = new Date(lastCheck.getTime() - overlapMs);
      const newJobs = await prisma.job.findMany({
        where: { AND: [{ companyId: { in: companyIds } }, { detectedAt: { gt: since } }, recentJobVisibilityWhere()] },
        include: { company: { select: { name: true, slug: true, logoUrl: true } } },
        orderBy: { detectedAt: "asc" },
      });
      const matchedJobs = newJobs.filter((job: any) =>
        jobMatchesAnyWatchlist(
          { companyId: job.companyId, title: job.title, location: job.location, seniority: job.seniority },
          watchlists
        )
      ).filter((job: any) =>
        isDashboardVisibleJob({
          postedAt: job.postedAt ?? null,
          detectedAt: job.detectedAt,
          location: job.location ?? null,
          title: job.title,
        })
      );
      let maxDetectedAt = lastCheck;
      for (const job of matchedJobs) {
        if (sentJobIds.has(job.id)) continue;
        send("new-job", {
          id: job.id,
          externalId: job.externalId,
          title: job.title,
          url: job.url,
          team: job.team,
          location: job.location,
          seniority: job.seniority,
          postedAt: job.postedAt ? job.postedAt.toISOString() : null,
          detectedAt: job.detectedAt.toISOString(),
          company: job.company,
        });
        sentJobIds.add(job.id);
        if (job.detectedAt > maxDetectedAt) {
          maxDetectedAt = job.detectedAt;
        }
      }
      // Advance cursor even if no matched jobs to prevent replay loops.
      if (newJobs.length > 0) {
        const newest = newJobs[newJobs.length - 1].detectedAt;
        if (newest > maxDetectedAt) maxDetectedAt = newest;
      }
      lastCheck = maxDetectedAt;
      pruneSentCache();
    } catch {}
  }, 1000);
  req.raw.on("close", () => {
    clearInterval(interval);
    clearInterval(heartbeat);
    reply.raw.end();
  });
  return reply;
});

app.put("/api/settings", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const body = (req.body || {}) as any;
  const telegramChatId =
    typeof body.telegramChatId === "string" && body.telegramChatId.trim()
      ? body.telegramChatId.trim()
      : null;
  const telegramEnabled = Boolean(body.telegramEnabled && telegramChatId);
  const preferences = await prisma.userPreferences.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      emailMode: body.emailMode || "instant",
      quietHoursStart: body.quietHoursStart,
      quietHoursEnd: body.quietHoursEnd,
      timezone: body.timezone || "UTC",
      telegramEnabled,
      telegramChatId,
    },
    update: {
      emailMode: body.emailMode,
      quietHoursStart: body.quietHoursStart,
      quietHoursEnd: body.quietHoursEnd,
      timezone: body.timezone,
      telegramEnabled,
      telegramChatId,
    },
  });
  return preferences;
});

app.post("/api/push/subscribe", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  const body = (req.body || {}) as any;
  const endpoint = body?.endpoint;
  const keys = body?.keys;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return reply.code(400).send({ error: "Invalid push subscription" });
  }
  const existing = await prisma.pushSubscription.findFirst({ where: { userId: user.id, endpoint } });
  if (existing) return { message: "Already subscribed" };
  const subscription = await prisma.pushSubscription.create({
    data: { userId: user.id, type: "web", endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  return reply.code(201).send(subscription);
});

app.post("/api/checkout", async (req, reply) => {
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  if (!stripe) return reply.code(503).send({ error: "Stripe is not configured" });
  const body = (req.body || {}) as any;
  const PRICE_IDS: Record<string, string> = {
    pro: process.env.STRIPE_PRO_PRICE_ID || "",
    teams: process.env.STRIPE_TEAMS_PRICE_ID || "",
  };
  const priceId = PRICE_IDS[body.plan];
  if (!priceId) return reply.code(400).send({ error: "Invalid plan" });
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXTAUTH_URL}/dashboard?upgraded=true`,
    cancel_url: `${process.env.NEXTAUTH_URL}/upgrade`,
    metadata: { userId: user.id },
    customer_email: user.email || undefined,
  });
  return { url: checkoutSession.url };
});

app.post("/api/webhooks/stripe", async (req, reply) => {
  if (!stripe) return reply.code(503).send({ error: "Stripe is not configured" });
  const sig = req.headers["stripe-signature"];
  if (!sig || Array.isArray(sig)) return reply.code(400).send({ error: "Missing stripe-signature" });
  let event: Stripe.Event;
  try {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET || "");
  } catch (err: any) {
    return reply.code(400).send({ error: `Webhook Error: ${err?.message || "invalid signature"}` });
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (userId) await prisma.user.update({ where: { id: userId }, data: { plan: "pro" } });
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      if (userId) await prisma.user.update({ where: { id: userId }, data: { plan: "free" } });
      break;
    }
  }
  return { received: true };
});

app.post("/api/dev/reset", async (req, reply) => {
  if (process.env.ENABLE_DEV_DATA_RESET !== "true") {
    return reply.code(403).send({ error: "Disabled. Set ENABLE_DEV_DATA_RESET=true in .env" });
  }
  const user = await requireUser(req);
  if (!user) return reply.code(401).send({ error: "Unauthorized" });
  await prisma.notification.deleteMany();
  await prisma.application.deleteMany();
  await prisma.job.deleteMany();
  const { deleted } = await clearWorkerJobCache();
  return { ok: true, message: "All jobs removed; worker cache keys cleared.", redisKeysRemoved: deleted };
});

await app.listen({ port: PORT, host: "0.0.0.0" });
app.log.info(`Backend API listening on ${PORT}`);
