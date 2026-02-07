import * as cheerio from "cheerio";
import { fetchTextWithCookies } from "../lib/http.mjs";
import { absoluteUrl, cleanText } from "../lib/normalize.mjs";

/**
 * Generic SAP / SuccessFactors-style HTML job board adapter.
 * Improved: extracts ONLY the job content and strips scripts/CSS/cookie banners.
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

      // Remove script/style + obvious boilerplate containers BEFORE extracting text.
      stripNoise($);

      const title = cleanText($("h1").first().text()) || "Unknown title";

      // SuccessFactors often has a small meta line near title:
      // "Mainz, Germany | full time | Job ID: 11010"
      const detailLine = cleanText($("h1").first().nextAll().first().text());
      const locPart = detailLine.split("|")[0]?.trim() || "";
      const location = cleanText(locPart) || null;

      // Extract the job content from best candidates (in order).
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
      console.error(`[${company.id}] detail failed: ${jobUrl} :: ${e?.message || e}`);
    }
  }

  console.log(`[${company.id}] listLinks=${jobLinks.size} jobs=${jobs.length}`);
  return jobs;
}

/**
 * Remove scripts/styles and common non-content areas (header/nav/footer/cookie consent).
 */
function stripNoise($) {
  $("script, style, noscript").remove();

  // common site chrome
  $("header, nav, footer").remove();

  // common cookie/consent containers (varies by tenant/theme)
  $(
    [
      "#onetrust-consent-sdk",
      "#cookieConsentManager",
      ".cookie",
      ".cookie-consent",
      ".cookieConsent",
      ".onoffswitch",
      ".ot-sdk-container",
      "[id*=cookie]",
      "[class*=cookie]"
    ].join(",")
  ).remove();

  // remove common “utility” blocks that often pollute text
  $(
    [
      "form",
      ".searchResults",
      ".search-results",
      ".pagination",
      ".jobAlert",
      ".job-alert",
      ".subscribe",
      ".emailsubscribe",
      "[data-testid*=jobAlert]"
    ].join(",")
  ).remove();
}

/**
 * Extract job description from best-guess containers for SuccessFactors/J2W pages.
 * We prioritize content-like regions and avoid global chrome.
 */
function extractJobDescriptionText($) {
  // Preferred containers found across many SuccessFactors/J2W themes
  const candidates = [
    // common main job section wrappers
    "#jobDescriptionText",
    ".job-description",
    ".jobDescription",
    ".jobdesc",
    "[data-testid*=jobDescription]",
    // often there is a content column
    "#content",
    ".content",
    ".content-area",
    ".main-content",
    "main",
    "article"
  ];

  for (const sel of candidates) {
    const el = $(sel).first();
    if (el && el.length) {
      const t = cleanText(el.text());
      if (isGoodDescription(t)) return postProcessDescription(t);
    }
  }

  // Last resort: body (already stripped of scripts/headers/footers/cookies)
  const bodyText = cleanText($("body").text());
  return isGoodDescription(bodyText) ? postProcessDescription(bodyText) : null;
}

function isGoodDescription(t) {
  if (!t) return false;

  // Avoid returning very short or clearly non-description strings
  if (t.length < 200) return false;

  // Heuristic: should contain job-ish headings/words
  const s = t.toLowerCase();
  const signals = [
    "the position",
    "about the role",
    "tasks",
    "responsibilities",
    "requirements",
    "your contribution",
    "qualifications",
    "what you will",
    "apply"
  ];
  return signals.some((x) => s.includes(x));
}

function postProcessDescription(t) {
  // remove common trailing blocks that still sneak in
  let out = t;

  // Chop at "Find similar jobs" / "Terms of Use" / "Data Privacy" if present
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

  // Collapse whitespace
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

// Merge "Cookie" header string with Set-Cookie responses
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
