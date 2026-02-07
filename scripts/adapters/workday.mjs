import { fetchText } from "../lib/http.mjs";
import {
  cleanText,
  stripHtml,
  safeIsoDate,
  normalizeWorkplace,
  normalizeEmploymentType
} from "../lib/normalize.mjs";

/**
 * Workday public "cxs" endpoints are the most stable way to scrape Workday.
 *
 * This version fixes:
 * 1) Human URL vs API URL:
 *    - url/applyUrl should point to the human job page:
 *      https://<host>/<site>/job/...
 *    - API detail JSON stays at:
 *      https://<host>/wday/cxs/<tenant>/<site>/job/...
 *
 * 2) Location extraction:
 *    - Prefer list endpoint fields
 *    - Fall back to job detail JSON jobPostingInfo fields
 */
export async function scrapeWorkday({
  company,
  host,
  tenant,
  site,
  searchText = "",
  max = 500
}) {
  const scrapedAt = new Date().toISOString();

  // Human-facing base (what users should see when clicking "View original posting")
  // Example: https://immatics.wd3.myworkdayjobs.com/Immatics_External
  const humanBase = company.careersUrl.replace(/\/+$/, "");

  // API base
  // Example: https://immatics.wd3.myworkdayjobs.com/wday/cxs/immatics/Immatics_External
  const apiBase = `https://${host}/wday/cxs/${tenant}/${site}`.replace(/\/+$/, "");

  const listEndpoint = `${apiBase}/jobs`;

  async function getPage(offset, limit) {
    // Variant A: GET with query params
    const urlA = `${listEndpoint}?offset=${offset}&limit=${limit}&searchText=${encodeURIComponent(
      searchText
    )}`;
    const a = await tryJson(urlA);
    if (a?.jobPostings) return a;

    // Variant B: POST with JSON body
    const b = await tryPostJson(listEndpoint, {
      appliedFacets: {},
      searchText,
      limit,
      offset
    });
    if (b?.jobPostings) return b;

    // Variant C: some tenants use "query" instead of "searchText"
    const c = await tryPostJson(listEndpoint, {
      appliedFacets: {},
      query: searchText,
      limit,
      offset
    });
    if (c?.jobPostings) return c;

    return null;
  }

  async function tryJson(url) {
    try {
      const txt = await fetchText(url, {
        headers: { accept: "application/json,text/plain,*/*" }
      });
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }

  async function tryPostJson(url, body) {
    try {
      return await postJson(url, body);
    } catch {
      return null;
    }
  }

  async function postJson(url, body) {
    const { fetch } = await import("undici");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "application/json,text/plain,*/*",
        "content-type": "application/json",
        "accept-language": "en-US,en;q=0.8,de-DE;q=0.7,de;q=0.6"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} Workday POST`);
    return await res.json();
  }

  async function getJobDetailJson(externalPath) {
    // externalPath typically looks like: "/job/Tuebingen-Germany/Role-_JR123"
    // Detail JSON is under API base:
    //   https://host/wday/cxs/tenant/site + externalPath
    const apiDetailUrl = `${apiBase}${externalPath}`;
    return await tryJson(apiDetailUrl);
  }

  const jobs = [];
  const seen = new Set();

  let offset = 0;
  const limit = 20;

  while (jobs.length < max) {
    const page = await getPage(offset, limit);
    if (!page || !Array.isArray(page.jobPostings) || page.jobPostings.length === 0) break;

    for (const jp of page.jobPostings) {
      const externalPath = cleanText(jp.externalPath || "");
      if (!externalPath.startsWith("/job/")) continue;

      // ✅ Human URL (NOT the API URL)
      const humanUrl = new URL(externalPath, `${humanBase}/`).toString();

      if (seen.has(humanUrl)) continue;
      seen.add(humanUrl);

      const title = cleanText(jp.title) || "Unknown title";

      // First attempt: list endpoint location fields
      const listLoc = pickFirstNonEmpty([
        jp.locationsText,
        Array.isArray(jp.locations) ? jp.locations.join(", ") : "",
        jp.location,
        jp.primaryLocation
      ]);

      // Fetch detail JSON to improve location + description robustness
      let detail = null;
      let detailLocation = null;
      let descriptionText = null;
      let postedAt = safeIsoDate(jp?.postedOn ?? jp?.postedDate ?? null);

      try {
        detail = await getJobDetailJson(externalPath);
        if (detail?.jobPostingInfo) {
          descriptionText = stripHtml(detail.jobPostingInfo.jobDescription || "");

          // Workday detail location fields can vary by tenant
          detailLocation = extractLocationFromDetail(detail.jobPostingInfo);

          // Some tenants include posted date in detail
          postedAt = postedAt || safeIsoDate(detail.jobPostingInfo?.postedOn ?? null);
        }
      } catch {
        // ignore detail failure; keep list-only fields
      }

      const location = cleanText(detailLocation || listLoc) || null;

      // ID: prefer a Workday request / JR id if present, otherwise stable by URL
      const jr =
        (Array.isArray(jp.bulletFields) ? jp.bulletFields.find((x) => String(x).startsWith("JR")) : null) ||
        null;

      jobs.push({
        id: jr ? `workday:${jr}` : `workday:${Buffer.from(humanUrl).toString("base64url")}`,
        company,
        title,
        location,
        workplace: normalizeWorkplace(location || ""),
        employmentType: normalizeEmploymentType(jp?.timeType ?? jp?.categoriesText ?? ""),
        department: cleanText(jp?.jobFamily ?? jp?.category ?? "") || null,
        team: null,

        // ✅ user-facing URL
        url: humanUrl,
        applyUrl: humanUrl,

        // ✅ description from detail JSON (cleaned)
        description: { text: descriptionText || null, html: null },

        source: { kind: "workday_api", raw: { externalPath } },
        postedAt,
        scrapedAt
      });
    }

    offset += page.jobPostings.length;
    if (page.jobPostings.length < limit) break;
  }

  return jobs;
}

function pickFirstNonEmpty(values) {
  for (const v of values) {
    const s = cleanText(v || "");
    if (s) return s;
  }
  return "";
}

/**
 * Extract a useful location string from Workday jobPostingInfo.
 * Tenants differ, so we try multiple patterns.
 */
function extractLocationFromDetail(info) {
  // Common patterns: string fields
  const direct = pickFirstNonEmpty([
    info.location,
    info.locationsText,
    info.primaryLocation
  ]);
  if (direct) return direct;

  // Sometimes locations are arrays of strings
  if (Array.isArray(info.locations) && info.locations.length) {
    return cleanText(info.locations.join(", "));
  }

  // Sometimes locations are arrays of objects
  // Try typical keys
  const objArrays = [info.additionalLocations, info.jobLocations, info.locations];
  for (const arr of objArrays) {
    if (!Array.isArray(arr) || arr.length === 0) continue;

    const parts = arr
      .map((x) => {
        if (!x) return "";
        if (typeof x === "string") return x;
        return (
          x.displayName ||
          x.location ||
          x.city ||
          x.name ||
          ""
        );
      })
      .map((s) => cleanText(s))
      .filter(Boolean);

    if (parts.length) return parts.join(", ");
  }

  // Sometimes location is a nested object
  const locObj = info.jobRequisitionLocation || info.primaryLocationObject || null;
  if (locObj && typeof locObj === "object") {
    const parts = [
      locObj.displayName,
      locObj.city,
      locObj.country,
      locObj.name
    ]
      .map((s) => cleanText(s || ""))
      .filter(Boolean);
    if (parts.length) return parts.join(", ");
  }

  return "";
}
