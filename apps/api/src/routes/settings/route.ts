import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const body = await req.json();

  const { emailMode, quietHoursStart, quietHoursEnd, timezone } = body;

  const preferences = await prisma.userPreferences.upsert({
    where: { userId },
    create: {
      userId,
      emailMode: emailMode || "instant",
      quietHoursStart,
      quietHoursEnd,
      timezone: timezone || "UTC",
    },
    update: {
      emailMode,
      quietHoursStart,
      quietHoursEnd,
      timezone,
    },
  });

  return NextResponse.json(preferences);
}
