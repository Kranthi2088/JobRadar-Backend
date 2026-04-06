import { chromium } from "playwright";

const url =
  process.argv[2] || "https://apply.careers.microsoft.com/careers?hl=en";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });

const selectors = [
  'a[href*="/job"]',
  'a[href*="position"]',
  "[data-testid*='job']",
  ".position-title",
  "a.job-card",
];

for (const sel of selectors) {
  try {
    await page.waitForSelector(sel, { timeout: 15_000 });
    console.log("FOUND selector:", sel);
    const n = await page.locator(sel).count();
    console.log("count:", n);
    break;
  } catch {
    console.log("miss:", sel);
  }
}

await new Promise((r) => setTimeout(r, 3000));
const sample = await page.evaluate(() => {
  const links = [...document.querySelectorAll("a[href]")]
    .filter((a) => {
      const h = a.getAttribute("href") || "";
      return (
        /job|position|apply|req=/i.test(h) &&
        !h.startsWith("javascript") &&
        h.length > 5
      );
    })
    .slice(0, 25)
    .map((a) => ({
      href: a.getAttribute("href"),
      text: (a.textContent || "").trim().slice(0, 100),
    }));
  return links;
});
console.log("--- job-like links ---");
console.log(JSON.stringify(sample, null, 2));
await browser.close();
