import { fetchText } from "../lib/http.mjs";
import {
  cleanText,
  stripHtml,
  safeIsoDate,
  normalizeWorkplace,
  normalizeEmploymentType
} from "../lib/normalize.mjs";

export async function scrapeWorkday({
  company,
  host,
  tenant,
  site,
  searchText = "",
  max = 500
}) {
  const scrapedAt = new Date().toISOString();

  const humanBase = normalizeBase(company.careersUrl);
  const apiBase = normalizeBase(`https://${host}/wday/cxs/${tenant}/${site}`);
  const listEndpoint = `${apiBase}/jobs`;

  async function tryJson(url) {
    try {
      const txt = await fetchText(url, { headers: { accept: "application/json,text/plain,*/*" } });
      return JSON.parse(txt);
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

  async function getPage(offset, limit) {
    const urlA = `${listEndpoint}?offset=${offset}&limit=${limit}&searchText=${encodeURIComponent(searchText)}`;
    const a = await tryJson(urlA);
    if (a?.jobPostings) return a;

    const b = await postJson(listEndpoint, { appliedFacets: {}, searchText, limit, offset }).catch(() => null);
    if (b?.jobPostings) return b;

    const c = await postJson(listEndpoint, { appliedFacets: {}, query: searchText, limit, offset }).catch(() => null);
    if (c?.jobPostings) return c;

    return null;
  }

  async function getJobDetailJson(externalPath) {
    const apiDetailUrl = `${apiBase}${externalPath}`;
    return await tryJson(apiDetailUrl);
  }

  const jobs = [];
  const seen = new Set();
  let offset = 0;
  const limit = 20;

  while (jobs.length < max) {
    const page = await getPage(offset, limit);
    if (!page?.jobPostings?.length) break;

    for (const jp of page.jobPostings) {
      const externalPath = cleanText(jp.externalPath || "");
      if (!externalPath.startsWith("/job/")) continue;

      // ✅ Correct human URL (keeps /site and locale because it’s in humanBase)
      const humanUrl = `${humanBase}${externalPath}`;

      if (seen.has(humanUrl)) continue;
      seen.add(humanUrl);

      const title = cleanText(jp.title) || "Unknown title";

      const listLoc = pickFirstNonEmpty([
        jp.locationsText,
        Array.isArray(jp.locations) ? jp.locations.join(", ") : "",
        jp.location,
        jp.primaryLocation
      ]);

      let descriptionText = null;
      let detailLoc = null;
      let postedAt = safeIsoDate(jp?.postedOn ?? jp?.postedDate ?? null);

      try {
        const detail = await getJobDetailJson(externalPath);
        if (detail?.jobPostingInfo) {
          descriptionText = stripHtml(detail.jobPostingInfo.jobDescription || "");
          detailLoc = extractLocationsFromDetail(detail.jobPostingInfo);
          postedAt = postedAt || safeIsoDate(detail.jobPostingInfo?.postedOn ?? null);
        }
      } catch {
        // ignore
      }

      const location = cleanText(detailLoc || listLoc) || null;

      const jr =
        (Array.isArray(jp.bulletFields)
          ? jp.bulletFields.find((x) => String(x).startsWith("JR"))
          : null) || null;

      jobs.push({
        id: jr ? `workday:${jr}` : `workday:${Buffer.from(humanUrl).toString("base64url")}`,
        company,
        title,
        location,
        workplace: normalizeWorkplace(location || ""),
        employmentType: normalizeEmploymentType(jp?.timeType ?? jp?.categoriesText ?? ""),
        department: cleanText(jp?.jobFamily ?? jp?.category ?? "") || null,
        team: null,
        url: humanUrl,
        applyUrl: humanUrl,
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

function normalizeBase(u) {
  const url = new URL(u);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function pickFirstNonEmpty(values) {
  for (const v of values) {
    const s = cleanText(v || "");
    if (s) return s;
  }
  return "";
}

/**
 * Returns a single string including ALL locations:
 * - handles locationsText with newlines
 * - handles arrays of strings/objects
 */
function extractLocationsFromDetail(info) {
  // 1) locationsText often contains newline-separated locations
  const lt = cleanText(String(info.locationsText || "").replace(/\n+/g, ", "));
  if (lt) return lt;

  // 2) direct string
  const direct = cleanText(info.location || info.primaryLocation || "");
  if (direct) return direct;

  // 3) arrays
  const arrays = [info.additionalLocations, info.jobLocations, info.locations];
  for (const arr of arrays) {
    if (!Array.isArray(arr) || arr.length === 0) continue;

    const parts = arr
      .map((x) => {
        if (!x) return "";
        if (typeof x === "string") return x;
        return x.displayName || x.location || x.city || x.name || "";
      })
      .map((s) => cleanText(s))
      .filter(Boolean);

    if (parts.length) return parts.join(", ");
  }

  // 4) nested object
  const locObj = info.jobRequisitionLocation || info.primaryLocationObject || null;
  if (locObj && typeof locObj === "object") {
    const parts = [locObj.displayName, locObj.city, locObj.country, locObj.name]
      .map((s) => cleanText(s || ""))
      .filter(Boolean);
    if (parts.length) return parts.join(", ");
  }

  return "";
}
