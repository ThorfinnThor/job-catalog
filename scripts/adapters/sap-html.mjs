import * as cheerio from "cheerio";
import { fetchTextWithCookies } from "../lib/http.mjs";
import { absoluteUrl, cleanText } from "../lib/normalize.mjs";

export async function scrapeSapHtml({
  company,
  pageSize = 100,
  maxStart = 5000,
  stopAfterNoNewLinks = true
}) {
  const scrapedAt = new Date().toISOString();

  let cookieJar = "";
  const jobLinks = new Set();

  // ---- LIST PAGINATION ----
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

  // ---- DETAIL SCRAPE ----
  const jobs = [];

  for (const jobUrl of jobLinks) {
    try {
      const { text: jobHtml, cookies } = await fetchTextWithCookies(jobUrl, cookieJar);
      if (cookies?.length) cookieJar = mergeCookies(cookieJar, cookies);

      const $ = cheerio.load(jobHtml);

      stripNoise($);

      const title = cleanText($("h1").first().text()) || "Unknown title";

      const meta = extractSapLocationAndMetaLine($);
      const location = meta.location;

      const descriptionText = extractJobDescriptionText($);

      const jobIdMatch = jobHtml.match(/Job ID\\s*:\\s*([0-9]+)/i);
      const jobId = jobIdMatch ? jobIdMatch[1] : null;
      const id = jobId
        ? `${company.id}:${jobId}`
        : `${company.id}_url:${Buffer.from(jobUrl).toString("base64url")}`;

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
        employmentType: /full\\s*time/i.test(meta.metaLine) ? "full_time" : null,
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

/** Remove page chrome + scripts/styles (keep content + sidebar text). */
function stripNoise($) {
  $("script, style, noscript").remove();
  $("header, nav, footer").remove();

  // Cookie/consent blocks
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
 * Location extraction tuned to screenshots:
 * - BioNTech: "Mainz, Germany | full time | Job ID: ..."
 * - Boehringer: sidebar "Primary location" -> "Ingelheim, Germany"
 */
function extractSapLocationAndMetaLine($) {
  // 1) BioNTech-style meta line (pipes) – scan near title first
  const h1 = $("h1").first();
  const nearTitle = cleanText(h1.parent().text());
  const fromNear = parsePipeMetaLine(nearTitle);
  if (fromNear?.location) return fromNear;

  // Sometimes meta line is a sibling block, not in parent
  const siblingText = cleanText(h1.parent().nextAll().slice(0, 3).text());
  const fromSib = parsePipeMetaLine(siblingText);
  if (fromSib?.location) return fromSib;

  // 2) Boehringer-style "Primary location" label in sidebar
  // Extract from overall visible text (after stripNoise)
  const mainText = cleanText(($("main").text() || $("body").text()).slice(0, 6000));
  const primary = extractAfterLabel(mainText, [
    "Primary location",
    "Primary Location",
    "Primärer Standort",
    "Primaerer Standort"
  ]);
  if (primary) {
    return { location: primary, metaLine: `Primary location: ${primary}` };
  }

  // 3) Fallback: any location-ish selectors (low risk)
  const selectorCandidates = [
    ".jobGeoLocation",
    ".job-location",
    ".jobLocation",
    "[data-testid*=location]"
  ];
  for (const sel of selectorCandidates) {
    const t = cleanText($(sel).first().text());
    if (t && t.length <= 120) return { location: t, metaLine: t };
  }

  // 4) Last resort: scan top of page text for pipe meta line
  const topText = cleanText(($("body").text() || "").slice(0, 4000));
  const fromTop = parsePipeMetaLine(topText);
  if (fromTop?.location) return fromTop;

  return { location: null, metaLine: "" };
}

function parsePipeMetaLine(text) {
  const t = cleanText(text);
  if (!t) return null;

  // Matches: "<location> | <something> | Job ID"
  // Location often looks like: "Mainz, Germany"
  const m = t.match(
    /(.{3,120}?)\\s*\\|\\s*(full\\s*time|part\\s*time|contract|internship|temporary)\\s*\\|\\s*job\\s*id/i
  );
  if (!m) return null;

  const loc = cleanText(m[1]);
  if (!loc) return null;

  return { location: loc, metaLine: cleanText(m[0]) };
}

/**
 * Extract value after a label in a "sidebar" text block.
 * Example input text contains:
 * "Primary location Ingelheim, Germany Job function Marketing, Sales ..."
 */
function extractAfterLabel(text, labels) {
  const t = cleanText(text);
  if (!t) return null;

  for (const label of labels) {
    const re = new RegExp(`${escapeRe(label)}\\s+(.{3,120}?)\\s+(Job ID|Job function|Career level|Organization|Working time|Job flexibility|Tasks|The Position|Requirements|Apply)`, "i");
    const m = t.match(re);
    if (m && m[1]) return cleanText(m[1]);
  }

  // Fallback: grab until end of sentence if sidebar structure differs
  for (const label of labels) {
    const re = new RegExp(`${escapeRe(label)}\\s+([^\\n\\r]{3,120})`, "i");
    const m = t.match(re);
    if (m && m[1]) {
      const val = cleanText(m[1]);
      // avoid capturing too much
      if (val.length <= 80) return val;
    }
  }

  return null;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
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
      if (t && t.length > 300) return postProcessDescription(t);
    }
  }

  const bodyText = cleanText($("body").text());
  return bodyText && bodyText.length > 300 ? postProcessDescription(bodyText) : null;
}

function postProcessDescription(t) {
  let out = t;

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
