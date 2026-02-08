import { fetchJson } from "../lib/http.mjs";
import { cleanText, absoluteUrl } from "../lib/normalize.mjs";

/**
 * Workday CXS API adapter
 *
 * Base API:
 *   https://{host}/wday/cxs/{tenant}/{site}/jobs
 *
 * Pagination is tenant-dependent:
 * - Many require POST with JSON body: { limit, offset, searchText, appliedFacets }
 * - Some allow GET (often without params) and return a capped list (commonly 500)
 *
 * Strategy:
 * 1) Prefer POST pagination (reliable when supported)
 * 2) If POST returns 400, fall back to GET without params (legacy behavior)
 */
export async function scrapeWorkday({
  company,
  host,
  tenant,
  site,
  pageSize = 100,
  maxTotal = 10000
}) {
  const scrapedAt = new Date().toISOString();
  const apiBase = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

  // Use the human careersUrl (from sites.mjs) to build job links reliably
  // e.g. https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers
  const humanBase = company.careersUrl?.replace(/\/+$/, "") || `https://${host}/${site}`;

  let items = [];
  let total = null;

  // ---- Attempt POST pagination ----
  try {
    let offset = 0;

    while (true) {
      const body = {
        // Many tenants accept this exact shape
        limit: pageSize,
        offset,
        searchText: "",
        appliedFacets: {}
      };

      const data = await fetchJson(apiBase, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json,text/plain,*/*",
          origin: `https://${host}`,
          referer: `${humanBase}/`
        },
        body: JSON.stringify(body),
        timeoutMs: 25000,
        retries: 6
      });

      const pageItems =
        Array.isArray(data?.jobPostings) ? data.jobPostings :
        Array.isArray(data?.items) ? data.items :
        [];

      if (total === null) {
        total =
          (typeof data?.total === "number" ? data.total : null) ??
          (typeof data?.totalResults === "number" ? data.totalResults : null) ??
          null;
      }

      if (!pageItems.length) break;

      items.push(...pageItems);
      offset += pageItems.length;

      if (items.length >= maxTotal) break;
      if (typeof total === "number" && offset >= total) break;
      if (pageItems.length < pageSize) break;
    }
  } catch (e) {
    // If POST pagination fails (commonly HTTP 400), fall back to GET without pagination params
    console.error(
      `[${company.id}] Workday POST pagination failed; falling back to GET (reason: ${e?.message || e})`
    );

    const data = await fetchJson(apiBase, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,*/*",
        origin: `https://${host}`,
        referer: `${humanBase}/`
      },
      timeoutMs: 25000,
      retries: 6
    });

    items =
      Array.isArray(data?.jobPostings) ? data.jobPostings :
      Array.isArray(data?.items) ? data.items :
      [];

    total =
      (typeof data?.total === "number" ? data.total : null) ??
      (typeof data?.totalResults === "number" ? data.totalResults : null) ??
      null;
  }

  // ---- Map to unified jobs ----
  const jobs = [];

  for (const p of items) {
    // Workday varies; try common identifiers
    const reqId =
      p?.bulletFields?.reqId ||
      p?.reqId ||
      p?.jobReqId ||
      null;

    const title = cleanText(p?.title) || "Unknown title";

    // locationsText is common ("China - Shanghai - Shanghai")
    const location =
      cleanText(p?.locationsText) ||
      cleanText(p?.primaryLocation) ||
      null;

    const externalPath = p?.externalPath || p?.path || null;

    // Build canonical job URL using careersUrl base
    const url = externalPath ? absoluteUrl(humanBase, externalPath) : humanBase;

    // Many tenants include a short description field in the listing response
    const desc =
      cleanText(p?.jobDescription) ||
      cleanText(p?.description) ||
      null;

    const stableId = reqId ? String(reqId) : (externalPath ? externalPath : url);
    const id = `${company.id}:${Buffer.from(stableId).toString("base64url")}`;

    jobs.push({
      id,
      company,
      title,
      language: undefined, // filled later in scrape-jobs.mjs enrichment
      location,
      locationParsed: undefined, // filled later
      locationConfidence: undefined, // filled later
      workplace: null, // enriched later
      workplaceConfidence: undefined, // enriched later
      employmentType: cleanText(p?.timeType) || null,
      department: cleanText(p?.jobFamily) || null,
      team: null,
      url,
      applyUrl: url,
      description: { text: desc, html: null },
      source: { kind: "workday_api", raw: { host, tenant, site } },
      postedAt: p?.postedOn || p?.postedDate || null,
      scrapedAt
    });
  }

  console.log(
    `[${company.id}] workday fetched=${items.length} total=${total ?? "unknown"}`
  );

  return jobs;
}
