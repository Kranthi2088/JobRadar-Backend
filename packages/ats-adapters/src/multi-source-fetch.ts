import type { NormalizedJob } from "@jobradar/shared";
import { createAdapter } from "./factory";
import { computeListingKey } from "./listing-key";

export type CompanySourceRow = {
  id: string;
  atsType: string;
  endpoint: string;
  priority: number;
};

function enrichWithListingKey(
  job: Omit<NormalizedJob, "listingKey">
): NormalizedJob {
  return {
    ...job,
    listingKey: computeListingKey(job.url),
  };
}

function sortSources(
  sources: CompanySourceRow[],
  preferredSourceId?: string | null
): CompanySourceRow[] {
  const list = [...sources].filter((s) => s.id);
  const pref = preferredSourceId?.trim();
  let head: CompanySourceRow[] = [];
  let rest = list;
  if (pref) {
    const i = list.findIndex((s) => s.id === pref);
    if (i >= 0) {
      head = [list[i]];
      rest = list.filter((_, j) => j !== i);
    }
  }
  rest.sort((a, b) => a.priority - b.priority);
  return [...head, ...rest];
}

export type PerSourceResult = {
  sourceId: string;
  ok: boolean;
  count: number;
  error?: string;
};

/**
 * Waterfall: try sources in order (sticky `preferredSourceId` first, then ascending `priority`).
 * On **error** or **zero jobs**, try the next source. Stops at the **first** source that returns
 * at least one job. Configure ATS first, then `custom` (static HTML), then `playwright` on the
 * same careers URL as last resort — see seed data.
 */
export async function fetchJobsFromAllSources(params: {
  slug: string;
  sources: CompanySourceRow[];
  preferredSourceId?: string | null;
}): Promise<{
  jobs: NormalizedJob[];
  perSource: PerSourceResult[];
  primarySourceId: string | null;
}> {
  const ordered = sortSources(params.sources, params.preferredSourceId);
  const perSource: PerSourceResult[] = [];
  let jobs: NormalizedJob[] = [];
  let primarySourceId: string | null = null;

  for (const src of ordered) {
    try {
      const adapter = createAdapter(src.atsType);
      const raw = await adapter.fetchJobs(params.slug, src.endpoint);
      const enriched = raw.map((j) =>
        enrichWithListingKey({
          ...j,
          companySlug: params.slug,
        })
      );

      perSource.push({
        sourceId: src.id,
        ok: true,
        count: enriched.length,
      });

      if (enriched.length > 0) {
        jobs = enriched.map((j) => ({
          ...j,
          companySourceId: src.id,
        }));
        primarySourceId = src.id;
        break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      perSource.push({
        sourceId: src.id,
        ok: false,
        count: 0,
        error: msg,
      });
    }
  }

  return { jobs, perSource, primarySourceId };
}
