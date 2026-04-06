import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@jobradar/db";
import { jobMatchesAnyWatchlist } from "@jobradar/shared";
import { recentJobVisibilityWhere } from "@/lib/watchlist-jobs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = (session.user as any).id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      send("connected", { message: "SSE connected", userId });

      const watchlists = await prisma.watchlist.findMany({
        where: { userId },
        select: {
          companyId: true,
          roleKeyword: true,
          locationFilter: true,
          seniorityFilter: true,
        },
      });

      const companyIds = watchlists.map((w) => w.companyId);

      let lastCheck = new Date();

      const interval = setInterval(async () => {
        try {
          const newJobs = await prisma.job.findMany({
            where: {
              AND: [
                { companyId: { in: companyIds } },
                { detectedAt: { gt: lastCheck } },
                recentJobVisibilityWhere(),
              ],
            },
            include: {
              company: { select: { name: true, slug: true, logoUrl: true } },
            },
            orderBy: { detectedAt: "desc" },
          });

          const matchedJobs = newJobs.filter((job) =>
            jobMatchesAnyWatchlist(
              {
                companyId: job.companyId,
                title: job.title,
                location: job.location,
                seniority: job.seniority,
              },
              watchlists
            )
          );

          for (const job of matchedJobs) {
            send("new-job", {
              id: job.id,
              externalId: job.externalId,
              title: job.title,
              url: job.url,
              team: job.team,
              location: job.location,
              seniority: job.seniority,
              postedAt: job.postedAt
                ? job.postedAt instanceof Date
                  ? job.postedAt.toISOString()
                  : job.postedAt
                : null,
              detectedAt:
                job.detectedAt instanceof Date
                  ? job.detectedAt.toISOString()
                  : job.detectedAt,
              company: job.company,
            });
          }

          lastCheck = new Date();
        } catch {
          // Client likely disconnected
        }
      }, 5_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
