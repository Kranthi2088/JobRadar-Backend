import type { NormalizedJob } from "@jobradar/shared";
import { ATSAdapter } from "../adapter";
import { extractJobsFromHtml } from "../html-extract";

/**
 * Renders the careers page in headless Chromium (for SPAs / lazy content).
 * Requires: `npx playwright install chromium` once after install.
 */
export class PlaywrightCareersAdapter extends ATSAdapter {
  readonly atsType = "playwright";

  async fetchJobs(companySlug: string, endpoint: string): Promise<NormalizedJob[]> {
    if (!endpoint) {
      throw new Error("PlaywrightCareersAdapter requires careers page URL");
    }

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 JobRadar/1.0",
      });
      await page.goto(endpoint, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {
        /* some sites never reach idle */
      });
      // SPAs (e.g. Microsoft Eightfold) render listings after hydration — wait for job anchors.
      await page
        .waitForSelector('a[href*="/job"]', { timeout: 60_000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      const html = await page.content();
      return extractJobsFromHtml(html, endpoint, companySlug, this.atsType);
    } finally {
      await browser.close();
    }
  }

  getApplyUrl(job: NormalizedJob): string {
    return job.url;
  }
}
