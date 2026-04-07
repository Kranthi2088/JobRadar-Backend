import { RECENT_JOB_POST_WINDOW_MS } from "./constants";

/**
 * Dashboard shows US-only roles. Many ATS rows put country/city in the title and leave
 * `location` null — treat US signals in either field.
 */
const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND",
  "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];
const US_CITY_STATE_RE = new RegExp(`\\b(?:${US_STATE_CODES.join("|")})\\b`);

/** Same rolling window as recent-job ingest and dashboard queries (24h). */
export const DASHBOARD_VISIBILITY_WINDOW_MS = RECENT_JOB_POST_WINDOW_MS;

function usSignalsIn(text: string): boolean {
  const s = text.toLowerCase();
  return (
    s.includes("united states") ||
    s.includes(" usa") ||
    s.includes(", us") ||
    s.includes("remote, us") ||
    s.includes("u.s.") ||
    US_CITY_STATE_RE.test(text)
  );
}

/** True if the job appears US-based from structured location and/or title text. */
export function isUnitedStatesJobLocationOrTitle(
  location: string | null | undefined,
  title: string | null | undefined
): boolean {
  const loc = location?.trim();
  const tit = title?.trim();
  if (loc && usSignalsIn(loc)) return true;
  if (tit && usSignalsIn(tit)) return true;
  return false;
}
