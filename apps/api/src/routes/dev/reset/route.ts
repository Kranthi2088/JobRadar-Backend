import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";
import { clearWorkerJobCache } from "@/lib/redis";

/**
 * Deletes all jobs (and related rows) and clears worker Redis cache patterns.
 * Guarded for local development — set ENABLE_DEV_DATA_RESET=true to allow.
 */
export async function POST() {
  if (process.env.ENABLE_DEV_DATA_RESET !== "true") {
    return NextResponse.json(
      { error: "Disabled. Set ENABLE_DEV_DATA_RESET=true in .env" },
      { status: 403 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.notification.deleteMany();
  await prisma.application.deleteMany();
  await prisma.job.deleteMany();

  const { deleted } = await clearWorkerJobCache();

  return NextResponse.json({
    ok: true,
    message: "All jobs removed; worker cache keys cleared.",
    redisKeysRemoved: deleted,
  });
}
