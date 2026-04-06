import type { NormalizedJob } from "@jobradar/shared";
import { ATSAdapter } from "../adapter";
import { captureJobsFromPageApi } from "./page-api-capture";

type MetaJobNode = {
  id?: string | number;
  title?: string;
  locations?: string[];
  teams?: string[];
  sub_teams?: string[];
  posted_date?: number | string;
};

type MetaGraphqlPayload = {
  data?: {
    job_search_with_featured_jobs?: {
      all_jobs?: MetaJobNode[];
    };
  };
};

export class MetaGraphqlAdapter extends ATSAdapter {
  readonly atsType = "meta_graphql";

  async fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]> {
    const pageUrl = endpoint?.trim() || "https://www.metacareers.com/jobsearch";
    const captured = await captureJobsFromPageApi<NormalizedJob>({
      pageUrl,
      timeoutMs: 16_000,
      maxPayloads: 30,
      matchResponse: (url) => url.includes("/graphql"),
      parsePayload: (payload) => this.parseJobsFromPayload(payload, companySlug),
    });

    const byId = new Map<string, NormalizedJob>();
    for (const j of captured) {
      const k = j.id || j.url;
      if (!byId.has(k)) byId.set(k, j);
    }
    return [...byId.values()];
  }

  getApplyUrl(job: NormalizedJob): string {
    return job.url;
  }

  private parseJobsFromPayload(payload: unknown, companySlug: string): NormalizedJob[] {
    const p = payload as MetaGraphqlPayload;
    const rows = p?.data?.job_search_with_featured_jobs?.all_jobs;
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const jobs: NormalizedJob[] = [];
    for (const row of rows) {
      const id = row?.id != null ? String(row.id) : "";
      const title = row?.title?.trim() || "";
      if (!id || !title) continue;

      const postedAt = this.parseEpoch(row.posted_date);
      jobs.push({
        id,
        title,
        url: `https://www.metacareers.com/profile/job_details/${id}`,
        team: Array.isArray(row.teams) && row.teams.length ? row.teams.join(" · ") : undefined,
        location:
          Array.isArray(row.locations) && row.locations.length
            ? row.locations.join(" · ")
            : undefined,
        seniority:
          Array.isArray(row.sub_teams) && row.sub_teams.length
            ? row.sub_teams.join(" · ")
            : undefined,
        postedAt: postedAt ?? undefined,
        detectedAt: new Date(),
        companySlug,
        atsType: this.atsType,
      });
    }
    return jobs;
  }

  private parseEpoch(input: number | string | undefined): Date | null {
    if (input == null) return null;
    const n = typeof input === "string" ? Number(input) : input;
    if (!Number.isFinite(n)) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
