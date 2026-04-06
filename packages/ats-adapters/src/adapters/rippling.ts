import type { NormalizedJob } from "@jobradar/shared";
import { ATSAdapter } from "../adapter";

interface RipplingJob {
  id: string;
  name: string;
  slug: string;
  department?: string;
  workLocation?: string;
  employmentType?: string;
}

interface RipplingResponse {
  jobs: RipplingJob[];
}

export class RipplingAdapter extends ATSAdapter {
  readonly atsType = "rippling";

  async fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]> {
    const url = endpoint || `https://app.rippling.com/api/o/jobs/${companySlug}`;
    const data = await this.fetchJSON<RipplingResponse>(url);

    return (data.jobs ?? []).map((job) => this.normalize(job, companySlug));
  }

  getApplyUrl(job: NormalizedJob): string {
    return job.url;
  }

  private normalize(job: RipplingJob, companySlug: string): NormalizedJob {
    return {
      id: job.id,
      title: job.name,
      url: `https://app.rippling.com/careers/${companySlug}/${job.slug || job.id}`,
      team: job.department,
      location: job.workLocation,
      seniority: this.inferSeniority(job.name),
      detectedAt: new Date(),
      companySlug,
      atsType: this.atsType,
    };
  }

  private inferSeniority(title: string): string | undefined {
    const lower = title.toLowerCase();
    if (lower.includes("intern")) return "Intern";
    if (lower.includes("senior") || lower.includes("sr.")) return "Senior";
    if (lower.includes("staff")) return "Staff";
    if (lower.includes("lead")) return "Lead";
    return undefined;
  }
}
