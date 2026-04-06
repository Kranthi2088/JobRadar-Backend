import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";
import { PLAN_LIMITS, type PlanType } from "@jobradar/shared";
import { fetchAndUpsertCompanyJobs } from "@/lib/upsert-fetched-jobs";
import { getRedis } from "@/lib/redis";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const watchlists = await prisma.watchlist.findMany({
    where: { userId },
    include: { company: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(watchlists);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const plan = ((session.user as any).plan || "free") as PlanType;
  const body = await req.json();

  const { companyId, roleKeyword, locationFilter, seniorityFilter, pollingIntervalSeconds } =
    body;

  if (!companyId || !roleKeyword) {
    return NextResponse.json(
      { error: "companyId and roleKeyword are required" },
      { status: 400 }
    );
  }

  let intervalSec = Number(pollingIntervalSeconds);
  if (!Number.isFinite(intervalSec) || intervalSec < 60) intervalSec = 300;
  if (intervalSec > 86_400) intervalSec = 86_400;

  const currentCount = await prisma.watchlist.count({ where: { userId } });
  const limit = PLAN_LIMITS[plan].maxCompanies;

  if (currentCount >= limit) {
    return NextResponse.json(
      {
        error: `Free plan is limited to ${limit} companies. Upgrade to Pro for unlimited.`,
        upgrade: true,
      },
      { status: 403 }
    );
  }

  const loc =
    typeof locationFilter === "string" && locationFilter.trim()
      ? locationFilter.trim()
      : null;

  const sen =
    typeof seniorityFilter === "string" && seniorityFilter.trim()
      ? seniorityFilter.trim()
      : null;

  const watchlist = await prisma.watchlist.create({
    data: {
      userId,
      companyId,
      roleKeyword,
      pollingIntervalSeconds: intervalSec,
      locationFilter: loc,
      seniorityFilter: sen,
    },
    include: { company: true },
  });

  const companyForFetch = await prisma.company.findFirst({
    where: { id: companyId, isActive: true },
    include: {
      sources: {
        where: { isActive: true },
        orderBy: { priority: "asc" },
      },
    },
  });

  if (companyForFetch?.sources.length) {
    void fetchAndUpsertCompanyJobs({
      id: companyForFetch.id,
      slug: companyForFetch.slug,
      preferredSourceId: companyForFetch.preferredSourceId,
      sources: companyForFetch.sources.map((s) => ({
        id: s.id,
        atsType: s.atsType,
        endpoint: s.endpoint,
        priority: s.priority,
      })),
    }).catch((err) => {
      console.error("[watchlist] initial fetch failed", companyForFetch.slug, err);
    });

    const redis = getRedis();
    if (redis) {
      void redis.del(`poll:last-at:${companyForFetch.slug}`).catch(() => {});
    }
  }

  return NextResponse.json(watchlist, { status: 201 });
}
