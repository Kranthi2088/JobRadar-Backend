import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id;
  const body = await req.json();

  const { endpoint, keys } = body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json(
      { error: "Invalid push subscription" },
      { status: 400 }
    );
  }

  const existing = await prisma.pushSubscription.findFirst({
    where: { userId, endpoint },
  });

  if (existing) {
    return NextResponse.json({ message: "Already subscribed" });
  }

  const subscription = await prisma.pushSubscription.create({
    data: {
      userId,
      type: "web",
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  });

  return NextResponse.json(subscription, { status: 201 });
}
