import * as cheerio from "cheerio";
import type { NormalizedJob } from "@jobradar/shared";

const SELECTORS = [
  /** Google careers job rows: `jobs/results/{numericId}-slug` */
  'a[href^="jobs/results/"]',
  'a[href*="/jobs/results/"]',
  'a[href*="/jobs/"]',
  /** Microsoft / Eightfold use /careers/job/{id} */
  'a[href*="/careers/job"]',
  'a[href*="/job/"]',
  'a[href*="/careers/"]',
  'a[href*="/positions/"]',
  'a[href*="/openings/"]',
  ".job-listing a",
  ".career-listing a",
  "[data-job-id]",
  ".posting-title a",
];

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `html-${Math.abs(hash).toString(36)}`;
}

/** Relative links like `jobs/results/{id}-title` must not be resolved against a base that already ends in `/jobs/results` (avoids `/jobs/jobs/results/...`). */
function resolveListingHref(href: string, baseUrl: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  let base = baseUrl;
  if (/\/jobs\/results\/?$/.test(base)) {
    base = base.replace(/\/jobs\/results\/?$/, "/");
  }
  return new URL(href, base).href;
}

/** Shared cheerio extraction for static HTML and Playwright-rendered HTML. */
export function extractJobsFromHtml(
  html: string,
  baseUrl: string,
  companySlug: string,
  atsTypeLabel: string
): NormalizedJob[] {
  const $ = cheerio.load(html);
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (const selector of SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");
      if (!href || seen.has(href)) return;

      let title = $el.text().trim();
      /** Google careers often puts title outside the `<a>` (empty text); derive from URL slug. */
      if (title.length < 3 && /jobs\/results\/\d+-/.test(href)) {
        const slug = href.split("/").pop() ?? "";
        const afterId = slug.replace(/^\d+-/, "");
        title = afterId.replace(/-/g, " ").trim() || slug;
      }

      if (!title || title.length < 3) return;
      seen.add(href);

      const url = href.startsWith("http")
        ? href
        : resolveListingHref(href, baseUrl);

      const id = $el.attr("data-job-id") || hashUrl(href);

      jobs.push({
        id,
        title,
        url,
        team: undefined,
        location: undefined,
        seniority: undefined,
        detectedAt: new Date(),
        companySlug,
        atsType: atsTypeLabel,
      });
    });
  }

  return jobs.filter((j) => {
    const u = j.url;
    if (/accounts\.google\.com/i.test(u)) return false;
    if (/\/jobs\/(recommendations|saved|alerts)\b/i.test(u)) return false;
    if (/\/about\/careers\/applications\//i.test(u) && !/\/jobs\/results\/\d+-/.test(u)) {
      return false;
    }
    return true;
  });
}
