import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const userId = (session.user as any).id;

  const application = await prisma.application.upsert({
    where: {
      userId_jobId: { userId, jobId: params.id },
    },
    create: { userId, jobId: params.id },
    update: {},
  });

  return NextResponse.json(application);
}
