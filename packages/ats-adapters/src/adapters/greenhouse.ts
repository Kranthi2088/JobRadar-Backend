import type { NormalizedJob } from "@jobradar/shared";
import { ATSAdapter } from "../adapter";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  updated_at: string;
  departments: Array<{ name: string }>;
  metadata?: Array<{ name: string; value: string | null }>;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export class GreenhouseAdapter extends ATSAdapter {
  readonly atsType = "greenhouse";

  async fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]> {
    const url = endpoint || `https://api.greenhouse.io/v1/boards/${companySlug}/jobs`;
    const data = await this.fetchJSON<GreenhouseResponse>(url);

    return data.jobs.map((job) => this.normalize(job, companySlug));
  }

  getApplyUrl(job: NormalizedJob): string {
    return job.url;
  }

  private normalize(job: GreenhouseJob, companySlug: string): NormalizedJob {
    const seniorityMeta = job.metadata?.find(
      (m) => m.name.toLowerCase() === "seniority" || m.name.toLowerCase() === "level"
    );

    let postedAt: Date | undefined;
    try {
      postedAt = new Date(job.updated_at);
      if (Number.isNaN(postedAt.getTime())) postedAt = undefined;
    } catch {
      postedAt = undefined;
    }

    return {
      id: String(job.id),
      title: job.title,
      url: job.absolute_url,
      team: job.departments?.[0]?.name,
      location: job.location?.name,
      seniority: seniorityMeta?.value ?? this.inferSeniority(job.title),
      postedAt,
      detectedAt: new Date(),
      companySlug,
      atsType: this.atsType,
    };
  }

  private inferSeniority(title: string): string | undefined {
    const lower = title.toLowerCase();
    if (lower.includes("intern")) return "Intern";
    if (lower.includes("junior") || lower.includes("jr.") || lower.includes("entry")) return "Junior";
    if (lower.includes("senior") || lower.includes("sr.")) return "Senior";
    if (lower.includes("staff")) return "Staff";
    if (lower.includes("principal")) return "Principal";
    if (lower.includes("lead")) return "Lead";
    if (lower.includes("manager") || lower.includes("director")) return "Manager";
    if (lower.includes("vp") || lower.includes("vice president")) return "VP";
    return undefined;
  }
}
