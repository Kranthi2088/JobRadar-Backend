import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const userId = (session.user as any).id;
  const body = await req.json();
  const { pollingIntervalSeconds, locationFilter, seniorityFilter } = body;

  const existing = await prisma.watchlist.findFirst({
    where: { id: params.id, userId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let intervalSec = Number(pollingIntervalSeconds);
  if (!Number.isFinite(intervalSec) || intervalSec < 60) intervalSec = existing.pollingIntervalSeconds;
  if (intervalSec > 86_400) intervalSec = 86_400;

  const loc =
    locationFilter === undefined
      ? undefined
      : typeof locationFilter === "string" && locationFilter.trim()
        ? locationFilter.trim()
        : null;

  const sen =
    seniorityFilter === undefined
      ? undefined
      : typeof seniorityFilter === "string" && seniorityFilter.trim()
        ? seniorityFilter.trim()
        : null;

  const updated = await prisma.watchlist.update({
    where: { id: params.id },
    data: {
      pollingIntervalSeconds: intervalSec,
      ...(loc !== undefined ? { locationFilter: loc } : {}),
      ...(sen !== undefined ? { seniorityFilter: sen } : {}),
    },
    include: { company: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const userId = (session.user as any).id;

  const watchlist = await prisma.watchlist.findFirst({
    where: { id: params.id, userId },
  });

  if (!watchlist) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.watchlist.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
