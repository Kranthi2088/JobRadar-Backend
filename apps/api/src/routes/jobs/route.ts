import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";
import { buildJobWhereFromWatchlists } from "@/lib/watchlist-jobs";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const searchParams = req.nextUrl.searchParams;

  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const company = searchParams.get("company");
  const keyword = searchParams.get("keyword");

  const watchlists = await prisma.watchlist.findMany({
    where: { userId },
    select: {
      companyId: true,
      roleKeyword: true,
      locationFilter: true,
      seniorityFilter: true,
    },
  });

  const allowedCompanyIds = new Set(watchlists.map((w) => w.companyId));
  const baseWhere = buildJobWhereFromWatchlists(watchlists);

  if (company && !allowedCompanyIds.has(company)) {
    return NextResponse.json({
      jobs: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    });
  }

  const where = {
    AND: [
      baseWhere,
      ...(company ? [{ companyId: company }] : []),
      ...(keyword
        ? [{ title: { contains: keyword, mode: "insensitive" as const } }]
        : []),
    ],
  };

  const jobs = await prisma.job.findMany({
    where,
    include: {
      company: { select: { name: true, slug: true, logoUrl: true } },
    },
    orderBy: [
      { postedAt: { sort: "desc", nulls: "last" } },
      { detectedAt: "desc" },
    ],
    skip: (page - 1) * limit,
    take: limit,
  });

  const total = await prisma.job.count({ where });

  return NextResponse.json({
    jobs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
