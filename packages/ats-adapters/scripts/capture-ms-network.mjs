import { chromium } from "playwright";

const url = "https://apply.careers.microsoft.com/careers?hl=en";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const hits = [];
page.on("response", async (res) => {
  const u = res.url();
  if (
    !/(\.png|\.jpg|\.woff|\.css|\.js|favicon|google-analytics|doubleclick)/i.test(
      u
    ) &&
    (/\/api\//i.test(u) ||
      /position|job|search|vacancy|listing/i.test(u) ||
      /eightfold|vs/i.test(u))
  ) {
    const ct = res.headers()["content-type"] || "";
    if (ct.includes("json") || u.includes("api")) {
      hits.push({ u, status: res.status(), ct });
    }
  }
});
await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector('a[href*="/job"]', { timeout: 60_000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 5000));
console.log(JSON.stringify(hits.slice(0, 40), null, 2));
await browser.close();
