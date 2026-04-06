export const REDIS_KEYS = {
  seenJob: (companySlug: string, jobId: string) =>
    `seen:${companySlug}:${jobId}`,
  seenJobsSet: (companySlug: string) => `seen-set:${companySlug}`,
  companyCircuitBreaker: (companySlug: string) =>
    `circuit:${companySlug}`,
} as const;

export const QUEUE_NAMES = {
  NEW_JOBS: "new-jobs",
  EMAIL_DIGEST: "email-digest",
} as const;

export const SEEN_JOB_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export const CIRCUIT_BREAKER = {
  FAILURE_THRESHOLD: 5,
  RECOVERY_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutes
} as const;

export const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

export const JOB_AGE_THRESHOLDS = {
  FRESH_MS: 60 * 60 * 1000,      // < 1 hour = green
  RECENT_MS: 6 * 60 * 60 * 1000, // 1-6 hours = amber
                                   // > 6 hours = gray
} as const;

/**
 * Rolling window for “still relevant” jobs in the UI and for ingest when the ATS
 * does not prove a fresh `postedAt` (see `shouldPersistFetchedJob`).
 */
export const RECENT_JOB_POST_WINDOW_MS = 24 * 60 * 60 * 1000;

export function recentJobPostedAfter(
  windowMs: number = RECENT_JOB_POST_WINDOW_MS
): Date {
  return new Date(Date.now() - windowMs);
}

/**
 * Persist a fetched job if it looks newly posted **or** we are seeing it on this fetch.
 * Some ATSes (e.g. Microsoft PCSX) attach a `postedAt` that is weeks old for still-open
 * roles; treating that as authoritative dropped ~297/300 listings. When `postedAt` is
 * stale, we still persist and rely on `detectedAt` (this fetch) plus the UI visibility
 * window.
 */
export function shouldPersistFetchedJob(job: {
  postedAt?: Date;
  detectedAt: Date;
}): boolean {
  const cutoff = Date.now() - RECENT_JOB_POST_WINDOW_MS;
  if (job.postedAt) {
    const posted = job.postedAt.getTime();
    if (posted >= cutoff) return true;
  }
  return job.detectedAt.getTime() >= cutoff;
}
