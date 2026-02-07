import * as cheerio from "cheerio";
import { writeFile } from "node:fs/promises";
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

    // Most Jobs2Web/SF boards support this lightweight format.
    // It’s MUCH less likely to 504 than the full HTML page.
    url.searchParams.set("startrow", String(start));
    url.searchParams.set("format", "ajax");

    const before = jobLinks.size;

    const { text: listHtml, cookies } = await fetchTextWithCookies(url.toString(), cookieJar);
    if (cookies?.length) cookieJar = mergeCookies(cookieJar, cookies);

    const $ = cheerio.load(listHtml);

    const linkSelectors = [
      "a[href*='/job/']",
      "a[href^='/job/']",
      "a[href*='job/']",
      "a[href*='?jobId=']"
    ];

    const anchors = $(linkSelectors.join(","));
    anchors.each((_, el) => {
      const href = $(el).attr("href");
      const full = absoluteUrl(company.careersUrl, href);
      if (!full) return;
      if (full.includes("/job/") || full.includes("?jobId=")) jobLinks.add(full);
    });

    if (start === 0 && jobLinks.size === 0) {
      await writeFile(`public/debug-${company.id}-list.html`, listHtml);
      console.error(
        `[${company.id}] ERROR: no job links found on first list page. Wrote public/debug-${company.id}-list.html`
      );
      break;
    }

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

function stripNoise($) {
  $("script, style, noscript").remove();
  $("header, nav, footer").remove();
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

function extractSapLocationAndMetaLine($) {
  // BioNTech style: "Mainz, Germany | full time | Job ID: 10606"
  const bodyTop = cleanText(($("body").text() || "").slice(0, 6000));
  const pipe = parsePipeMetaLine(bodyTop);
  if (pipe?.location) return pipe;

  // Boehringer style: sidebar “Primary location Ingelheim, Germany”
  const primary = extractAfterLabel(bodyTop, [
    "Primary location",
    "Primary Location",
    "Primärer Standort",
    "Primaerer Standort"
  ]);
  if (primary) return { location: primary, metaLine: `Primary location: ${primary}` };

  return { location: null, metaLine: "" };
}

function parsePipeMetaLine(text) {
  const t = cleanText(text);
  if (!t) return null;
  const m = t.match(
    /(.{3,120}?)\\s*\\|\\s*(full\\s*time|part\\s*time|contract|internship|temporary)\\s*\\|\\s*job\\s*id/i
  );
  if (!m) return null;
  const loc = cleanText(m[1]);
  if (!loc) return null;
  return { location: loc, metaLine: cleanText(m[0]) };
}

function extractAfterLabel(text, labels) {
  const t = cleanText(text);
  if (!t) return null;

  for (const label of labels) {
    const re = new RegExp(
      `${escapeRe(label)}\\s+(.{3,120}?)\\s+(Job ID|Job function|Career level|Organization|Working time|Job flexibility|Tasks|The Position|Requirements|Apply)`,
      "i"
    );
    const m = t.match(re);
    if (m && m[1]) return cleanText(m[1]);
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
