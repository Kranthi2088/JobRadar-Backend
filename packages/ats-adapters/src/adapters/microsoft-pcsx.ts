import type { NormalizedJob } from "@jobradar/shared";
import { ATSAdapter } from "../adapter";

/**
 * Microsoft careers public search API (PCSX / Eightfold-backed).
 * `endpoint` is the PCSX domain, e.g. `microsoft.com` (not a full URL).
 *
 * Docs discovered from network: GET …/api/pcsx/search?domain=…&query=&location=&start=…&hl=en
 */
const SEARCH_BASE = "https://apply.careers.microsoft.com/api/pcsx/search";

interface PcsxPosition {
  id: number;
  name: string;
  locations?: string[];
  department?: string;
  postedTs?: number;
  positionUrl?: string;
}

interface PcsxSearchResponse {
  data?: {
    positions?: PcsxPosition[];
    count?: number;
  };
}

export class MicrosoftPcsxAdapter extends ATSAdapter {
  readonly atsType = "microsoft_pcsx";

  async fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]> {
    const domain = this.normalizeDomain(endpoint, companySlug);
    const pageSize = 10;
    const maxJobs = Math.min(
      500,
      Math.max(
        50,
        parseInt(process.env.MICROSOFT_PCSX_MAX_JOBS || "300", 10) || 300
      )
    );

    const jobs: NormalizedJob[] = [];
    let start = 0;

    while (jobs.length < maxJobs) {
      const url = `${SEARCH_BASE}?domain=${encodeURIComponent(domain)}&query=&location=&start=${start}&hl=en`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "JobRadar/1.0 (https://jobradar.app)",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} from Microsoft PCSX search`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }

      const json = (await res.json()) as PcsxSearchResponse;
      const positions = json?.data?.positions ?? [];
      if (positions.length === 0) break;

      for (const p of positions) {
        if (jobs.length >= maxJobs) break;
        const path = p.positionUrl || `/careers/job/${p.id}`;
        const absolute = path.startsWith("http")
          ? path
          : `https://apply.careers.microsoft.com${path.startsWith("/") ? "" : "/"}${path}`;

        let postedAt: Date | undefined;
        if (p.postedTs != null && Number.isFinite(p.postedTs)) {
          const ms = p.postedTs > 1e12 ? p.postedTs : p.postedTs * 1000;
          const d = new Date(ms);
          if (!Number.isNaN(d.getTime())) postedAt = d;
        }

        jobs.push({
          id: String(p.id),
          title: p.name,
          url: absolute,
          team: p.department,
          location: p.locations?.length ? p.locations.join(" · ") : undefined,
          seniority: undefined,
          postedAt,
          detectedAt: new Date(),
          companySlug,
          atsType: this.atsType,
        });
      }

      if (positions.length < pageSize) break;
      start += pageSize;
    }

    return jobs;
  }

  getApplyUrl(job: NormalizedJob): string {
    return job.url;
  }

  /** `endpoint` from DB is usually `microsoft.com`; allow full URL or slug fallback. */
  private normalizeDomain(endpoint: string, companySlug: string): string {
    const t = endpoint?.trim();
    if (!t) return "microsoft.com";
    if (t.includes("microsoft.com")) {
      try {
        if (t.startsWith("http")) {
          const u = new URL(t);
          return u.searchParams.get("domain") || u.hostname.replace(/^www\./, "");
        }
      } catch {
        /* fall through */
      }
      return "microsoft.com";
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t) && !t.includes("/")) {
      return t;
    }
    if (companySlug === "microsoft") return "microsoft.com";
    return t;
  }
}
