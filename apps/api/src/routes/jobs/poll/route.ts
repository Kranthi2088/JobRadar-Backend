import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";
import { fetchAndUpsertCompanyJobs } from "@/lib/upsert-fetched-jobs";

/** Manual ATS fetch for testing — upserts jobs; does not enqueue notifications. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { companyId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const companyId = body.companyId?.trim();
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  const company = await prisma.company.findFirst({
    where: { id: companyId, isActive: true },
    include: {
      sources: {
        where: { isActive: true },
        orderBy: { priority: "asc" },
      },
    },
  });

  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  try {
    const { imported, primarySourceId, perSource } = await fetchAndUpsertCompanyJobs(company);
    return NextResponse.json({
      ok: true,
      company: { slug: company.slug, name: company.name },
      imported,
      primarySourceId,
      perSource,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
