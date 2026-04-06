/**
 * One-time: set `listingKey` from each job’s URL using the same hash as the worker
 * (`@jobradar/ats-adapters` computeListingKey). Run after `db:push` when `listingKey` was added.
 *
 *   npm run db:backfill-listing-keys
 *
 * If two rows share the same normalized URL for a company, the second gets a deterministic suffix.
 */
import { PrismaClient } from "@prisma/client";
import { computeListingKey } from "@jobradar/ats-adapters";

const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.job.findMany({
    where: { listingKey: null },
    select: { id: true, url: true, companyId: true },
  });

  if (jobs.length === 0) {
    console.log("No jobs with null listingKey — nothing to do.");
    return;
  }

  const used = new Map<string, Set<string>>();

  let updated = 0;
  for (const job of jobs) {
    let key = computeListingKey(job.url);
    const set = used.get(job.companyId) ?? new Set<string>();
    if (set.has(key)) {
      key = computeListingKey(`${job.url}\u0000${job.id}`);
    }
    set.add(key);
    used.set(job.companyId, set);

    await prisma.job.update({
      where: { id: job.id },
      data: { listingKey: key },
    });
    updated++;
  }

  console.log(`Backfilled listingKey for ${updated} job(s).`);
  console.log(
    "Optional: set `listingKey String` (required) in schema.prisma and run `npm run db:push` again."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
