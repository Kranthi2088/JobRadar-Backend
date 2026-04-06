import type { NormalizedJob } from "@jobradar/shared";
import { ATSAdapter } from "../adapter";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  categories: {
    team?: string;
    location?: string;
    department?: string;
    commitment?: string;
    level?: string;
  };
  createdAt: number;
  updatedAt?: number;
}

export class LeverAdapter extends ATSAdapter {
  readonly atsType = "lever";

  async fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]> {
    const url = endpoint || `https://api.lever.co/v0/postings/${companySlug}?mode=json`;
    const data = await this.fetchJSON<LeverPosting[]>(url);

    return data.map((posting) => this.normalize(posting, companySlug));
  }

  getApplyUrl(job: NormalizedJob): string {
    return job.url + "/apply";
  }

  private normalize(posting: LeverPosting, companySlug: string): NormalizedJob {
    const postedMs = posting.createdAt ?? posting.updatedAt;
    const postedAt =
      typeof postedMs === "number" && Number.isFinite(postedMs)
        ? new Date(postedMs)
        : undefined;

    return {
      id: posting.id,
      title: posting.text,
      url: posting.hostedUrl,
      team: posting.categories?.team || posting.categories?.department,
      location: posting.categories?.location,
      seniority: posting.categories?.level ?? this.inferSeniority(posting.text),
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
    return undefined;
  }
}
