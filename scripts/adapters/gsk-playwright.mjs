import { chromium } from "playwright";
import { cleanText, stableId } from "../lib/normalize.mjs";

/**
 * GSK's jobs site frequently returns 403 to non-browser clients.
 * This adapter uses Playwright + some basic stealth-ish hardening.
 *
 * It scrapes:
 * - job list page: collects job detail links that match /{locale}/jobs/{id}
 * - each job detail page: extracts title (h1), location heuristics, description heuristics
 */
export async function scrapeGskPlaywright({ company, startUrl, max = 200 }) {
  const scrapedAt = new Date().toISOString();

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1365, height: 768 }
  });

  // Try to reduce basic bot fingerprints
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    await page.goto(startUrl, { waitUntil: "networkidle", timeout: 60000 });
  } catch {
    // last attempt with domcontentloaded
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  }

  // Collect all candidate job links
  const hrefs = await page.$$eval("a[href]", (els) => els.map((a) => a.getAttribute("href") || ""));
  const links = Array.from(
    new Set(
      hrefs
        .filter(Boolean)
        .filter((h) => /\/jobs\/(\d{5,})/.test(h) || /\/jobs\?/.test(h) || /\/jobs\//.test(h))
        .map((h) => {
          try {
            return new URL(h, window.location.href).toString();
          } catch {
            return h;
          }
        })
    )
  );

  const jobLinks = links.filter((u) => /\/jobs\/(\d{5,})/.test(u));
  const limited = jobLinks.slice(0, max);

  const jobs = [];

  for (const jobUrl of limited) {
    try {
      await page.goto(jobUrl, { waitUntil: "networkidle", timeout: 60000 });

      const title = cleanText(await page.textContent("h1").catch(() => ""));
      const bodyText = cleanText(await page.textContent("body").catch(() => ""));

      // Location heuristics:
      // Many pages contain "Location:" or have breadcrumbs like "in Munich, Germany"
      let location = null;
      const m1 = bodyText.match(/\bLocation\b\s*[:\-]\s*([^\n\|]+?)(?:\s{2,}|\||$)/i);
      if (m1) location = cleanText(m1[1]);

      if (!location) {
        const m2 = bodyText.match(/\bin\s+([A-Za-z\-\s]+,\s*[A-Za-z\s]+)\./i);
        if (m2) location = cleanText(m2[1]);
      }

      // Description heuristics: take chunk around "Job description"
      let desc = null;
      const idx = bodyText.toLowerCase().indexOf("job description");
      if (idx >= 0) desc = bodyText.slice(idx);
      else desc = bodyText;

      jobs.push({
        id: stableId("gsk", jobUrl),
        company,
        title: title || "Unknown title",
        location,
        workplace: null,
        employmentType: null,
        department: null,
        team: null,
        url: jobUrl,
        applyUrl: jobUrl,
        description: { text: desc || null, html: null },
        source: { kind: "gsk_playwright" },
        postedAt: null,
        scrapedAt
      });
    } catch {
      // ignore
    }
  }

  await browser.close();
  return jobs;
}
