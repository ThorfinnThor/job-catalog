import { chromium } from "playwright";
import { cleanText, absoluteUrl } from "../lib/normalize.mjs";

/**
 * Workday adapter using Playwright (browser context).
 * This is the most robust approach when Workday returns HTTP 400 to server-side fetches.
 *
 * It loads the human careers page to establish cookies/session,
 * then calls the CXS endpoint from within the page using fetch().
 */
export async function scrapeWorkday({
  company,
  host,
  tenant,
  site,
  pageSize = 200,
  maxTotal = 5000
}) {
  const scrapedAt = new Date().toISOString();

  const apiUrl = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  const context = await browser.newContext({
    locale: "en-US",
  });

  const page = await context.newPage();

  try {
    // Prime cookies/session
    await page.goto(humanBase, { waitUntil: "domcontentloaded", timeout: 60000 });
    // give client scripts a moment (some tenants set cookies async)
    await page.waitForTimeout(1500);

    const extractPostings = (data) => {
      if (Array.isArray(data?.jobPostings)) return data.jobPostings;
      if (Array.isArray(data?.items)) return data.items;
      if (Array.isArray(data?.searchResults)) return data.searchResults;
      return [];
    };

    const extractTotal = (data) => {
      if (typeof data?.total === "number") return data.total;
      if (typeof data?.totalResults === "number") return data.totalResults;
      if (typeof data?.count === "number") return data.count;
      return null;
    };

    async function fetchPage(offset) {
      // Run in browser context with correct cookies/origin
      return await page.evaluate(async ({ apiUrl, offset, limit }) => {
        const tryBodies = [
          { appliedFacets: {}, limit, offset, searchText: "" },
          { appliedFacets: [], limit, offset, searchText: "" }
        ];

        let lastErr = null;

        for (const body of tryBodies) {
          try {
            const res = await fetch(apiUrl, {
              method: "POST",
              headers: {
                "content-type": "application/json;charset=UTF-8",
                "accept": "application/json, text/plain, */*"
              },
              body: JSON.stringify(body),
              credentials: "include"
            });

            const txt = await res.text();
            if (!res.ok) {
              lastErr = new Error(`HTTP ${res.status}: ${txt.slice(0, 500)}`);
              continue;
            }
            return JSON.parse(txt);
          } catch (e) {
            lastErr = e;
          }
        }

        throw lastErr || new Error("Workday fetch failed (unknown)");
      }, { apiUrl, offset, limit: pageSize });
    }

    const postings = [];
    let offset = 0;
    let total = null;

    while (true) {
      const data = await fetchPage(offset);
      const pageItems = extractPostings(data);
      if (total === null) total = extractTotal(data);

      if (!pageItems.length) break;

      postings.push(...pageItems);
      offset += pageItems.length;

      if (postings.length >= maxTotal) break;
      if (typeof total === "number" && offset >= total) break;
      if (pageItems.length < pageSize) break;
    }

    const jobs = postings.map((p) => {
      const title = cleanText(p?.title) || "Unknown title";

      const location =
        cleanText(p?.locationsText) ||
        cleanText(p?.primaryLocation) ||
        null;

      const externalPath = p?.externalPath || p?.path || null;
      const url = externalPath ? absoluteUrl(humanBase, externalPath) : humanBase;

      const descriptionText =
        cleanText(p?.jobDescription) ||
        cleanText(p?.description) ||
        null;

      const postedAt = p?.postedOn || p?.postedDate || null;

      const reqId =
        p?.bulletFields?.reqId ||
        p?.reqId ||
        p?.jobReqId ||
        null;

      const stableKey = reqId ? String(reqId) : (externalPath || url);
      const id = `${company.id}:${Buffer.from(stableKey).toString("base64url")}`;

      return {
        id,
        company,
        title,
        location,
        workplace: null, // enriched later
        employmentType: cleanText(p?.timeType) || null,
        department: cleanText(p?.jobFamily) || null,
        team: null,
        url,
        applyUrl: url,
        description: { text: descriptionText, html: null },
        source: { kind: "workday_playwright", raw: { host, tenant, site } },
        postedAt,
        scrapedAt
      };
    });

    console.log(`[${company.id}] workday fetched=${jobs.length} (playwright)`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
