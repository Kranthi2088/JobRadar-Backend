import type { NormalizedJob } from "@jobradar/shared";
import { createAdapter } from "./factory";
import { computeListingKey } from "./listing-key";

function withListingKeys(jobs: NormalizedJob[]): NormalizedJob[] {
  return jobs.map((j) => ({
    ...j,
    listingKey: j.listingKey ?? computeListingKey(j.url),
  }));
}

export type CompanyFetchConfig = {
  slug: string;
  atsType: string;
  atsEndpoint: string;
  fallbackAtsType?: string | null;
  fallbackEndpoint?: string | null;
  careersPageUrl?: string | null;
  /** If set, that strategy is tried first (saved from a previous successful poll). */
  preferredDataSource?: string | null;
};

type Step = { label: string; run: () => Promise<NormalizedJob[]> };

function buildSteps(config: CompanyFetchConfig): Step[] {
  const steps: Step[] = [];

  steps.push({
    label: `primary:${config.atsType}`,
    run: () => createAdapter(config.atsType).fetchJobs(config.slug, config.atsEndpoint),
  });

  if (config.fallbackAtsType && config.fallbackEndpoint) {
    const fbType = config.fallbackAtsType;
    const fbEndpoint = config.fallbackEndpoint;
    steps.push({
      label: `fallback:${fbType}`,
      run: () => createAdapter(fbType).fetchJobs(config.slug, fbEndpoint),
    });
  }

  if (config.careersPageUrl?.trim()) {
    const url = config.careersPageUrl.trim();
    steps.push({
      label: "careers-html",
      run: () => createAdapter("custom").fetchJobs(config.slug, url),
    });
    steps.push({
      label: "careers-playwright",
      run: () => createAdapter("playwright").fetchJobs(config.slug, url),
    });
  }

  const pref = config.preferredDataSource?.trim();
  if (pref) {
    const i = steps.findIndex((s) => s.label === pref);
    if (i > 0) {
      const copy = [...steps];
      const [chosen] = copy.splice(i, 1);
      return [chosen, ...copy];
    }
  }

  return steps;
}

/**
 * Tries primary ATS → optional secondary ATS → static HTML on careers URL → Playwright on careers URL.
 * Reorders so `preferredDataSource` runs first when set.
 * Returns the first strategy that yields at least one job; otherwise the last successful empty list or throws from last attempt.
 */
export async function fetchJobsWithFallback(
  config: CompanyFetchConfig
): Promise<{ jobs: NormalizedJob[]; source: string }> {
  const steps = buildSteps(config);

  let lastError: unknown;

  for (const { label, run } of steps) {
    try {
      const jobs = await run();
      if (jobs.length > 0) {
        return { jobs: withListingKeys(jobs), source: label };
      }
      // Responded OK but empty — prefer trying the next strategy (e.g. careers scrape).
      lastError = undefined;
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  if (lastError) {
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }

  return { jobs: [], source: "none" };
}

/** Ensures listingKey on jobs (e.g. after fetch). */
export { computeListingKey } from "./listing-key";
