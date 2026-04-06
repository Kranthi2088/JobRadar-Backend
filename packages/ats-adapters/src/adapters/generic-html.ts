import type { NormalizedJob } from "@jobradar/shared";
import { ATSAdapter } from "../adapter";
import { extractJobsFromHtml } from "../html-extract";

export class GenericHTMLAdapter extends ATSAdapter {
  readonly atsType = "custom";

  async fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]> {
    if (!endpoint) {
      throw new Error("GenericHTMLAdapter requires an endpoint URL");
    }

    const html = await this.fetchHTML(endpoint);
    return extractJobsFromHtml(html, endpoint, companySlug, this.atsType);
  }

  getApplyUrl(job: NormalizedJob): string {
    return job.url;
  }
}
