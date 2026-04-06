import type { NormalizedJob } from "@jobradar/shared";

export abstract class ATSAdapter {
  abstract readonly atsType: string;

  abstract fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]>;

  abstract getApplyUrl(job: NormalizedJob): string;

  protected async fetchJSON<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "JobRadar/1.0 (https://jobradar.app)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} from ${url}`);
      (error as any).status = response.status;
      throw error;
    }

    return response.json() as Promise<T>;
  }

  protected async fetchHTML(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} from ${url}`);
      (error as any).status = response.status;
      throw error;
    }

    return response.text();
  }
}
