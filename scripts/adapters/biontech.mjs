import * as cheerio from "cheerio";
import { fetchTextWithCookies } from "../lib/http.mjs";
import { absoluteUrl, cleanText } from "../lib/normalize.mjs";

/**
 * BioNTech (jobs.biontech.com) exposes job links in HTML, but uses session cookies
 * (careerSiteCompanyId, JSESSIONID, route, etc.). Persist cookies from list -> detail.
 */
export async function scrapeBiontech({ company }) {
  const scrapedAt = new Date().toISOString();

  // Cookie jar string like: "a=b; c=d"
  let cookieJar = "";

  const pageSize = 100;
  const jobLinks = new Set();

  // Try paging via startrow. Stop when no new links are discovered.
  for (let start = 0; start <= 5000; start += pageSize) {
    const url = new URL(company.careersUrl);
    url.searchParams.set("startrow", String(start));

    const { text, cookies } = await fetchTextWithCookies(url.toString(), cookieJar);
    if (cookies) cookieJar = mergeCookies(cookieJar, cookies);

    const $ = cheerio.load(text);

    const anchors = $("a[href*='/job/']");
    const before = jobLinks.size;

    anchors.each((_, el) => {
      const href = $(el).attr("href");
      const full = absoluteUrl(company.careersUrl, href);
      if (full && full.includes("/job/")) jobLinks.add(full);
    });

    const after = jobLinks.size;

    // If paging stops producing new links, break.
    if (after === before) break;

    // Defensive: if the page shows "Results 1 – 100 of ..." and only 3 pages,
    // start will exceed quickly anyway.
    if (anchors.length === 0) break;
  }

  const jobs = [];

  for (const jobUrl of jobLinks) {
    try {
      const { text: html, cookies } = await fetchTextWithCookies(jobUrl, cookieJar);
      if (cookies) cookieJar = mergeCookies(cookieJar, cookies);

      const $ = cheerio.load(html);

      const title = cleanText($("h1").first().text()) || "Unknown title";
      const headerLine = cleanText($("h1").first().nextAll().first().text());

      // Example detail line includes:
      // "Mainz, Germany; London, United Kingdom; ... | full time | Job ID: 11010"
      const detailLine = cleanText($("h1").first().nextAll().first().text());
      const locPart = detailLine.split("|")[0]?.trim() || "";
      const location = cleanText(locPart) || null;

      const jobIdMatch = html.match(/Job ID:\\s*([0-9]+)/i);
      const jobId = jobIdMatch ? jobIdMatch[1] : null;

      const applyHref =
        $("a:contains('Apply now')").first().attr("href") ||
        $("a:contains('Apply Now')").first().attr("href") ||
        null;

      const applyUrl = applyHref ? absoluteUrl(jobUrl, applyHref) : jobUrl;

      // Description: take the main content area as text, then trim
      const bodyText = cleanText($("body").text());
      let descriptionText = bodyText;

      const idx = bodyText.toLowerCase().indexOf("about the role");
      if (idx >= 0) descriptionText = bodyText.slice(idx);

      jobs.push({
        id: jobId ? `biontech:${jobId}` : `biontech_url:${jobUrl}`,
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
        source: { kind: "biontech_html", raw: { headerLine } },
        postedAt: null,
        scrapedAt
      });
    } catch (e) {
      // IMPORTANT: log failures so you can see why count is 0
      console.error(`[biontech] detail failed: ${jobUrl} :: ${e?.message || e}`);
    }
  }

  console.log(`[biontech] collected links=${jobLinks.size}, jobs=${jobs.length}`);
  return jobs;
}

// Merge "a=b; c=d" with an array of Set-Cookie strings
function mergeCookies(existingJar, setCookieHeaders) {
  const jarMap = new Map();

  // existing
  for (const part of String(existingJar || "").split(";")) {
    const kv = part.trim();
    if (!kv) continue;
    const eq = kv.indexOf("=");
    if (eq > 0) jarMap.set(kv.slice(0, eq), kv.slice(eq + 1));
  }

  // new
  for (const sc of setCookieHeaders) {
    // take only "name=value" before first ';'
    const nv = String(sc).split(";")[0].trim();
    const eq = nv.indexOf("=");
    if (eq > 0) jarMap.set(nv.slice(0, eq), nv.slice(eq + 1));
  }

  return Array.from(jarMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
