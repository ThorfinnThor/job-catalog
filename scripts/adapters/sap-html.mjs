import * as cheerio from "cheerio";
import { fetchTextWithCookies } from "../lib/http.mjs";
import { absoluteUrl, cleanText } from "../lib/normalize.mjs";

/**
 * SAP / SuccessFactors-style HTML job board adapter.
 * Fix: robust location extraction (meta line not always next sibling of H1).
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
    url.searchParams.set("startrow", String(start));

    const before = jobLinks.size;

    const { text: listHtml, cookies } = await fetchTextWithCookies(url.toString(), cookieJar);
    if (cookies?.length) cookieJar = mergeCookies(cookieJar, cookies);

    const $ = cheerio.load(listHtml);

    const anchors = $("a[href*='/job/']");
    anchors.each((_, el) => {
      const href = $(el).attr("href");
      const full = absoluteUrl(company.careersUrl, href);
      if (full && full.includes("/job/")) jobLinks.add(full);
    });

    const after = jobLinks.size;
    if (stopAfterNoNewLinks && after === before) break;
    if (anchors.length === 0) break;
  }

  // ---- 2) DETAIL SCRAPE ----
  const jobs = [];

  for (const jobUrl of jobLinks) {
    try {
      const { text: jobHtml, cookies } = await fetchTextWithCookies(jobUrl, cookieJar);
      if (cookies?.length) cookieJar = mergeCookies(cookieJar, cookies);

      const $ = cheerio.load(jobHtml);

      // Remove scripts/styles and obvious boilerplate before extraction
      stripNoise($);

      const title = cleanText($("h1").first().text()) || "Unknown title";

      // Robust: location may be in a meta line elsewhere, not just next sibling
      const { location, metaLine } = extractSapMeta($);

      // Description (same as your cleaned approach)
      const descriptionText = extractJobDescriptionText($);

      // Stable ID: prefer "Job ID: 12345" if present, otherwise base64 of URL
      const jobIdMatch = jobHtml.match(/Job ID\\s*:\\s*([0-9]+)/i);
      const jobId = jobIdMatch ? jobIdMatch[1] : null;
      const id = jobId
        ? `${company.id}:${jobId}`
        : `${company.id}_url:${Buffer.from(jobUrl).toString("base64url")}`;

      // Apply link (optional)
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
        employmentType: /full\\s*time/i.test(metaLine) ? "full_time" : null,
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
      console.error(`[${company.id}] detail failed: ${jobUrl} :: ${e?.message || e}`);
    }
  }

  console.log(`[${company.id}] listLinks=${jobLinks.size} jobs=${jobs.length}`);
  return jobs;
}

/** --- Helpers --- */

function stripNoise($) {
  $("script, style, noscript").remove();
  $("header, nav, footer").remove();

  // Cookie/consent containers
  $(
    [
      "#onetrust-consent-sdk",
      "#cookieConsentManager",
      ".cookie",
      ".cookie-consent",
      ".cookieConsent",
      ".ot-sdk-container",
      "[id*=cookie]",
      "[class*=cookie]"
    ].join(",")
  ).remove();
}

/**
 * Extract location from SuccessFactors meta line.
 * On these pages, the meta line often looks like:
 *   "Mainz, Germany | full time | Job ID: 1249417301"
 * but can be in a different container than "h1.next()".
 */
function extractSapMeta($) {
  const titleEl = $("h1").first();

  // 1) Try common “location/meta” selectors
  const selectorCandidates = [
    ".jobGeoLocation",
    ".job-location",
    ".jobLocation",
    "[data-testid*=location]",
    "[class*=location]",
    "[id*=location]"
  ];

  for (const sel of selectorCandidates) {
    const t = cleanText($(sel).first().text());
    // Ignore junk like "Location All"
    if (t && t.length < 120 && !t.toLowerCase().includes("location all")) {
      return { location: t, metaLine: t };
    }
  }

  // 2) Try to find a meta line near the title block (parent/siblings)
  const nearTitleText = cleanText(
    titleEl.parent().text() + " " + titleEl.parent().siblings().text()
  );

  const locFromNear = parseLocationFromMetaLine(nearTitleText);
  if (locFromNear) return { location: locFromNear.location, metaLine: locFromNear.metaLine };

  // 3) Fallback: scan the top of main/body text for the first meta line
  const topText = cleanText($("main").text() || $("body").text()).slice(0, 3000);
  const locFromTop = parseLocationFromMetaLine(topText);
  if (locFromTop) return { location: locFromTop.location, metaLine: locFromTop.metaLine };

  return { location: null, metaLine: "" };
}

function parseLocationFromMetaLine(text) {
  const t = cleanText(text);
  if (!t) return null;

  // Look for: "<location> | <something>"
  // where <something> could be "full time", "part time", or "Job ID"
  const m = t.match(
    /(.{3,120}?)\\s*\\|\\s*(full\\s*time|part\\s*time|contract|internship|temporary|job\\s*id)/i
  );
  if (!m) return null;

  // Clean up location fragment
  let loc = cleanText(m[1]);

  // Remove common leading noise
  loc = loc.replace(/^apply now\\s*»\\s*/i, "").trim();
  loc = loc.replace(/^loading\\.+\\s*/i, "").trim();

  // If location still looks like navigation garbage, reject
  if (!loc || loc.toLowerCase().includes("skip to main content")) return null;

  return { location: loc || null, metaLine: cleanText(m[0]) };
}

function extractJobDescriptionText($) {
  const candidates = [
    "#jobDescriptionText",
    ".job-description",
    ".jobDescription",
    ".jobdesc",
    "main",
    "article"
  ];

  for (const sel of candidates) {
    const el = $(sel).first();
    if (el && el.length) {
      const t = cleanText(el.text());
      if (t && t.length > 200) return postProcessDescription(t);
    }
  }

  const bodyText = cleanText($("body").text());
  return bodyText && bodyText.length > 200 ? postProcessDescription(bodyText) : null;
}

function postProcessDescription(t) {
  let out = t;

  // Cut off common footer/legal blocks
  const cutMarkers = [
    "find similar jobs",
    "terms of use",
    "general terms and conditions",
    "data privacy",
    "imprint",
    "cookie settings",
    "cookie consent manager"
  ];

  const lower = out.toLowerCase();
  let cutAt = -1;
  for (const m of cutMarkers) {
    const i = lower.indexOf(m);
    if (i >= 0) cutAt = cutAt < 0 ? i : Math.min(cutAt, i);
  }
  if (cutAt >= 0) out = out.slice(0, cutAt);

  return out.replace(/\\s+/g, " ").trim();
}

function mergeCookies(existingJar, setCookieHeaders) {
  const jarMap = new Map();

  for (const part of String(existingJar || "").split(";")) {
    const kv = part.trim();
    if (!kv) continue;
    const eq = kv.indexOf("=");
    if (eq > 0) jarMap.set(kv.slice(0, eq), kv.slice(eq + 1));
  }

  for (const sc of setCookieHeaders) {
    const nv = String(sc).split(";")[0].trim();
    const eq = nv.indexOf("=");
    if (eq > 0) jarMap.set(nv.slice(0, eq), nv.slice(eq + 1));
  }

  return Array.from(jarMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
