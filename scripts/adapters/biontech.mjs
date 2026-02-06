import * as cheerio from "cheerio";
import { fetchText } from "../lib/http.mjs";
import { absoluteUrl, cleanText, stripHtml } from "../lib/normalize.mjs";

/**
 * BioNTech runs a SAP-hosted career site that is scrape-friendly HTML:
 * - list pages: /search?...&startrow=0/100/...
 * - detail pages: /job/.../<jobPostingId>/
 */
export async function scrapeBiontech({ company }) {
  const scrapedAt = new Date().toISOString();

  // paginate using startrow=0,100,200 until no results
  const pageSize = 100;
  const jobLinks = new Set();

  for (let start = 0; start < 2000; start += pageSize) {
    const url = new URL(company.careersUrl);
    url.searchParams.set("startrow", String(start));
    // Keep a consistent sort order
    url.searchParams.set("sortColumn", "referencedate");
    url.searchParams.set("sortDirection", "desc");

    const html = await fetchText(url.toString());
    const $ = cheerio.load(html);

    // Job links are anchors under results table, typically /job/...
    const anchors = $("a[href^='/job/'], a[href*='/job/']");
    anchors.each((_, el) => {
      const href = $(el).attr("href");
      const full = absoluteUrl(company.careersUrl, href);
      if (full) jobLinks.add(full);
    });

    // heuristic: stop when fewer than ~10 job links found on a page after start>0
    if (start > 0 && anchors.length < 10) break;
  }

  const jobs = [];

  for (const jobUrl of jobLinks) {
    try {
      const html = await fetchText(jobUrl);
      const $ = cheerio.load(html);

      const title = cleanText($("h1").first().text());
      const headerLine = cleanText($("h1").first().nextAll().first().text());

      // Common format: "Mainz, Germany | full time | Job ID: 11005"
      const summary = cleanText($("h1").first().parent().text());
      const locationLine = cleanText($("h1").first().next().text()) || summary;

      const locationMatch = locationLine.split("|")[0]?.trim();
      const location = locationMatch ? cleanText(locationMatch) : null;

      const applyHref = $("a:contains('Apply now')").first().attr("href");
      const applyUrl = applyHref ? absoluteUrl(jobUrl, applyHref) : null;

      // Description: take everything after the header block until footer.
      // In practice, the entire content area is text-heavy, so grabbing body text works well.
      const contentText = cleanText($("body").text());
      // Reduce boilerplate by extracting a portion around "About the role" if present
      let descriptionText = contentText;
      const idx = contentText.toLowerCase().indexOf("about the role");
      if (idx >= 0) descriptionText = contentText.slice(idx);

      // Posted date isn't reliably on detail; on list it is. We keep null.
      const jobIdText = cleanText($("body").text().match(/Job ID\s*:\s*([0-9]+)/i)?.[1] ?? "");
      const stable = jobIdText ? `biontech:${jobIdText}` : `biontech_url:${jobUrl}`;

      jobs.push({
        id: stable,
        company,
        title: title || "Unknown title",
        location,
        workplace: null,
        employmentType: /full\s*time/i.test(locationLine) ? "full_time" : null,
        department: null,
        team: null,
        url: jobUrl,
        applyUrl,
        description: {
          text: descriptionText || null,
          html: null
        },
        source: { kind: "biontech_html", raw: { headerLine } },
        postedAt: null,
        scrapedAt
      });
    } catch {
      // ignore per-job failure
    }
  }

  return jobs;
}
