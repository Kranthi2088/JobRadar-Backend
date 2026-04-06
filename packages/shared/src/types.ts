export interface NormalizedJob {
  id: string;
  title: string;
  url: string;
  /** SHA-256 hex of normalized URL — set before DB persist (see @jobradar/ats-adapters). */
  listingKey?: string;
  /** CompanySource row when ingested via multi-source fetch. */
  companySourceId?: string;
  team?: string;
  location?: string;
  seniority?: string;
  /** When the ATS listing was published or last updated (best effort). */
  postedAt?: Date;
  detectedAt: Date;
  companySlug: string;
  atsType: string;
}

export interface WatchlistMatchInput {
  companyId: string;
  roleKeyword: string;
  locationFilter: string | null | undefined;
  seniorityFilter: string | null | undefined;
}

export interface JobMatchInput {
  companyId: string;
  title: string;
  location: string | null | undefined;
  seniority?: string | null;
}

/** Matches a job to one watchlist row (keyword + optional location + optional level). */
export function jobMatchesWatchlist(
  job: JobMatchInput,
  wl: WatchlistMatchInput
): boolean {
  if (job.companyId !== wl.companyId) return false;
  const kw = wl.roleKeyword?.trim();
  if (kw && !job.title.toLowerCase().includes(kw.toLowerCase())) return false;
  const locFilter = wl.locationFilter?.trim();
  if (locFilter) {
    const loc = (job.location ?? "").toLowerCase();
    if (!loc.includes(locFilter.toLowerCase())) return false;
  }
  const senFilter = wl.seniorityFilter?.trim();
  if (senFilter) {
    const s = (job.seniority ?? "").toLowerCase();
    const t = job.title.toLowerCase();
    const needle = senFilter.toLowerCase();
    if (!s.includes(needle) && !t.includes(needle)) return false;
  }
  return true;
}

export function jobMatchesAnyWatchlist(
  job: JobMatchInput,
  watchlists: WatchlistMatchInput[]
): boolean {
  return watchlists.some((wl) => jobMatchesWatchlist(job, wl));
}

export interface NewJobEvent {
  job: NormalizedJob;
  companyName: string;
  companyLogo?: string;
  matchedUserIds: string[];
}

export interface PollResult {
  companySlug: string;
  jobs: NormalizedJob[];
  newJobs: NormalizedJob[];
  pollDurationMs: number;
  timestamp: Date;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "down";
  activeWatchers: number;
  lastPollAt: Date;
  uptime: number;
  version: string;
}

/** Presets for watchlist polling (seconds). Max interval wins per company in worker. */
export const POLLING_INTERVAL_PRESETS: { label: string; seconds: number }[] = [
  { label: "Every 2 minutes", seconds: 120 },
  { label: "Every 5 minutes", seconds: 300 },
  { label: "Every 10 minutes", seconds: 600 },
  { label: "Every 15 minutes", seconds: 900 },
  { label: "Every 30 minutes", seconds: 1800 },
  { label: "Every 1 hour", seconds: 3600 },
];

export type PlanType = "free" | "pro" | "teams";

export const PLAN_LIMITS: Record<PlanType, {
  maxCompanies: number;
  maxKeywords: number;
  pollingIntervalMs: number;
  jobHistoryDays: number;
  channels: string[];
}> = {
  free: {
    maxCompanies: 5,
    maxKeywords: 1,
    pollingIntervalMs: 60_000,
    jobHistoryDays: 7,
    channels: ["web_push"],
  },
  pro: {
    maxCompanies: Infinity,
    maxKeywords: Infinity,
    pollingIntervalMs: 30_000,
    jobHistoryDays: 90,
    channels: ["web_push", "mobile_push", "email"],
  },
  teams: {
    maxCompanies: Infinity,
    maxKeywords: Infinity,
    pollingIntervalMs: 15_000,
    jobHistoryDays: 365,
    channels: ["web_push", "mobile_push", "email", "slack"],
  },
};
