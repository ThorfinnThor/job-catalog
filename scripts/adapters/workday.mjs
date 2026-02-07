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

  // Normalize human base (strip query/hash, no trailing slash)
  const humanBase = normalizeBase(company.careersUrl);

  // API base
  const apiBase = normalizeBase(`https://${host}/wday/cxs/${tenant}/${site}`);
  const listEndpoint = `${apiBase}/jobs`;

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
    // GET variant
    const urlA = `${listEndpoint}?offset=${offset}&limit=${limit}&searchText=${encodeURIComponent(
      searchText
    )}`;
    const a = await tryJson(urlA);
    if (a?.jobPostings) return a;

    // POST variant
    const b = await postJson(listEndpoint, {
      appliedFacets: {},
      searchText,
      limit,
      offset
    }).catch(() => null);
    if (b?.jobPostings) return b;

    // query variant
    const c = await postJson(listEndpoint, {
      appliedFacets: {},
      query: searchText,
      limit,
      offset
    }).catch(() => null);
    if (c?.jobPostings) return c;

    return null;
  }

  async function getJobDetailJson(externalPath) {
    // externalPath like "/job/City/Title_JR123"
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

      // ✅ Correct human URL (keeps /site and locale if present in humanBase)
      const humanUrl = `${humanBase}${externalPath}`;

      if (seen.has(humanUrl)) continue;
      seen.add(humanUrl);

      const title = cleanText(jp.title) || "Unknown title";

      // List-level location (often incomplete)
      const listLoc = pickFirstNonEmpty([
        jp.locationsText,
        Array.isArray(jp.locations) ? jp.locations.join(", ") : "",
        jp.location,
        jp.primaryLocation
      ]);

      // Detail JSON for better location + description
      let descriptionText = null;
      let detailLoc = null;
      let postedAt = safeIsoDate(jp?.postedOn ?? jp?.postedDate ?? null);

      try {
        const detail = await getJobDetailJson(externalPath);
        if (detail?.jobPostingInfo) {
          descriptionText = stripHtml(detail.jobPostingInfo.jobDescription || "");
          detailLoc = extractLocationFromDetail(detail.jobPostingInfo);
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
        url: humanUrl,      // ✅ not /wday/cxs/...
        applyUrl: humanUrl, // ✅ not /wday/cxs/...
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
  // remove trailing slash
  return url.toString().replace(/\/+$/, "");
}

function pickFirstNonEmpty(values) {
  for (const v of values) {
    const s = cleanText(v || "");
    if (s) return s;
  }
  return "";
}

function extractLocationFromDetail(info) {
  const direct = pickFirstNonEmpty([info.location, info.locationsText, info.primaryLocation]);
  if (direct) return direct;

  if (Array.isArray(info.locations) && info.locations.length) {
    return cleanText(info.locations.join(", "));
  }

  const objArrays = [info.additionalLocations, info.jobLocations, info.locations];
  for (const arr of objArrays) {
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

  const locObj = info.jobRequisitionLocation || info.primaryLocationObject || null;
  if (locObj && typeof locObj === "object") {
    const parts = [locObj.displayName, locObj.city, locObj.country, locObj.name]
      .map((s) => cleanText(s || ""))
      .filter(Boolean);
    if (parts.length) return parts.join(", ");
  }

  return "";
}
