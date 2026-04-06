type CaptureOptions<T> = {
  pageUrl: string;
  timeoutMs?: number;
  maxPayloads?: number;
  matchResponse: (url: string) => boolean;
  parsePayload: (payload: unknown) => T[];
};

function tryParseJsonLikeBody(body: string): unknown | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  // FB-style responses may prepend "for (;;);"
  const normalized = trimmed.startsWith("for (;;);")
    ? trimmed.slice("for (;;);".length).trim()
    : trimmed;

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

/**
 * Reusable helper for companies whose jobs are exposed only via browser API calls
 * (GraphQL/XHR) after page hydration.
 */
export async function captureJobsFromPageApi<T>(
  options: CaptureOptions<T>
): Promise<T[]> {
  const { chromium } = await import("playwright");
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxPayloads = options.maxPayloads ?? 20;
  const jobs: T[] = [];
  let payloadCount = 0;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 JobRadar/1.0",
    });

    page.on("response", async (resp) => {
      if (payloadCount >= maxPayloads) return;
      const url = resp.url();
      if (!options.matchResponse(url)) return;

      try {
        const body = await resp.text();
        const payload = tryParseJsonLikeBody(body);
        if (payload == null) return;

        const parsed = options.parsePayload(payload);
        if (parsed.length > 0) {
          jobs.push(...parsed);
        }
        payloadCount += 1;
      } catch {
        // Ignore individual response parse failures.
      }
    });

    await page.goto(options.pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.max(30_000, timeoutMs),
    });
    await page.waitForTimeout(timeoutMs);
  } finally {
    await browser.close();
  }

  return jobs;
}
