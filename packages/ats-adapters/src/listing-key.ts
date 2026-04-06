import { createHash } from "node:crypto";

/** Normalize listing URL so the same role from different trackers maps to one key. */
export function normalizeListingUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const drop = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
    ]);
    u.searchParams.forEach((_, k) => {
      if (drop.has(k.toLowerCase())) u.searchParams.delete(k);
    });
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function computeListingKey(url: string): string {
  return createHash("sha256").update(normalizeListingUrl(url)).digest("hex");
}
