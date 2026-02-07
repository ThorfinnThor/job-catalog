import * as cheerio from "cheerio";
import { fetchTextWithCookies } from "../lib/http.mjs";
import { absoluteUrl, cleanText } from "../lib/normalize.mjs";

/**
 * Generic SAP / SuccessFactors-style HTML job board adapter.
 *
 * Works well for portals like:
 * - https://jobs.biontech.com/search/
 * - https://jobs.boehringer-ingelheim.com/search/
 *
 * Strategy:
 * 1) Paginate list pages using startrow
 * 2) Extract job links from anchors containing "/job/"
 * 3) Visit each detail page and extract title, location, description
 * 4) Preserve cookies between requests to avoid session-related issues
 */
export async function scrapeSapHtml({
  company,
  pageSize = 100,
  maxStart = 5000,
  stopAfterNoNewLinks = true
}) {
  const scrapedAt = new Date().toISOString();

  let cookieJar = "";
  const jobLinks = new Set();

  // ---- 1) LIST PAGINATION via startrow ----
  for (let start = 0; start <= maxStart; start += pageSize) {
    const url = new URL(company.careersUrl);

    // Ensure we're on a search/listing URL; if someone passes the main domain,
    // this adapter expects careersUrl already points to /search/ (recommended).
    url.searchParams.set("startrow", String(start));

    const before = jobLinks.size;

    const { text: listHtml, cookies } = await fetchTextWithCookies(url.toString(), cookieJar);
    if (cookies?.length) cookieJar = mergeCookies(cookieJar, cookies);

    const $ = cheerio.load(listHtml);

    // Job links usually contain /job/
    // Example: /job/Mainz-.../1291168801/
    const anchors = $("a[href*='/job/']");
    anchors.each((_, el) => {
      const href = $(el).attr("href");
      const full = absoluteUrl(company.careersUrl, href);
      if (full && full.includes("/job/")) jobLinks.add(full);
    });

    const after = jobLinks.size;

    // Stop if this page didn't add new job links (common end condition).
    if (stopAfterNoNewLinks && after === before) break;

    // If a page has no job links at all, stop early.
    if (anchors.length === 0) break;
  }

  // ---- 2) DETAIL SCRAPE ----
  const jobs = [];

  for (const jobUrl of jobLinks) {
    try {
      const { text: jobHtml, cookies } = await fetchTextWithCookies(jobUrl, cookieJar);
      if (cookies?.length) cookieJar = mergeCookies(cookieJar, cookies);

      const $ = cheerio.load(jobHtml);

      const title = cleanText($("h1").first().text()) || "Unknown title";

      // Many SAP boards have a line near the title like:
      // "Mainz, Germany | full time | Job ID: 11010"
      // We extract the first pipe-separated segment as location.
      const detailLine = cleanText($("h1").first().nextAll().first().text());
      const locPart = detailLine.split("|")[0]?.trim() || "";
      const location = cleanText(locPart) || null;

      // Grab a big chunk of text; these pages are verbose but consistent.
      // In MVP, plain body text works well.
      let descriptionText = cleanText($("main").text());
      if (!descriptionText) descriptionText = cleanText($("body").text());

      // If page contains "About the role", start there to reduce boilerplate
      const idx = descriptionText.toLowerCase().indexOf("about the role");
      if (idx >= 0) descriptionText = descriptionText.slice(idx);

      // Stable ID: prefer "Job ID: 12345" if present, otherwise base64 of URL
      const jobIdMatch = jobHtml.match(/Job ID\\s*:\\s*([0-9]+)/i);
      const jobId = jobIdMatch ? jobIdMatch[1] : null;
      const id = jobId ? `${company.id}:${jobId}` : `${company.id}_url:${Buffer.from(jobUrl).toString("base64url")}`;

      // Try to locate an Apply link if present (optional)
      const applyHref =
        $("a:contains('Apply now')").first().attr("href") ||
        $("a:contains('Apply Now')").first().attr("href") ||
        null;
      const applyUrl = applyHref ? absoluteUrl(jobUrl, applyHref) : jobUrl;

      jobs.push({
        id,
        company,
        title,
        location,
        workplace: null,
        employmentType: /full\\s*time/i.test(detailLine) ? "full_time" : null,
        department: null,
        team: null,
        url: jobUrl,
        applyUrl,
        description: { text: descriptionText || null, html: null },
        source: { kind: "html", raw: { platform: "sap_successfactors_html" } },
        postedAt: null,
        scrapedAt
      });
    } catch (e) {
      // IMPORTANT: log failures so "0 jobs" is diagnosable
      console.error(`[${company.id}] detail failed: ${jobUrl} :: ${e?.message || e}`);
    }
  }

  console.log(`[${company.id}] listLinks=${jobLinks.size} jobs=${jobs.length}`);
  return jobs;
}

// Merge "Cookie" header string with Set-Cookie responses
function mergeCookies(existingJar, setCookieHeaders) {
  const jarMap = new Map();

  // Existing cookies
  for (const part of String(existingJar || "").split(";")) {
    const kv = part.trim();
    if (!kv) continue;
    const eq = kv.indexOf("=");
    if (eq > 0) jarMap.set(kv.slice(0, eq), kv.slice(eq + 1));
  }

  // New Set-Cookie headers (take name=value before ';')
  for (const sc of setCookieHeaders) {
    const nv = String(sc).split(";")[0].trim();
    const eq = nv.indexOf("=");
    if (eq > 0) jarMap.set(nv.slice(0, eq), nv.slice(eq + 1));
  }

  return Array.from(jarMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
