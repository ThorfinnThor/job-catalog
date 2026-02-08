import { fetchJson } from "../lib/http.mjs";
import { cleanText, absoluteUrl } from "../lib/normalize.mjs";

/**
 * Workday CXS adapter with robust fallbacks.
 *
 * Many Workday tenants:
 * - return HTTP 400 if you call /jobs with offset/limit as query params
 * - require POST with a specific payload shape
 *
 * Strategy:
 * 1) POST pagination using multiple payload variants (until one works)
 * 2) If POST always fails, try GET with no params (often returns a capped list like 500)
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

  // Use the careersUrl to build human job links reliably (locale-aware)
  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");

  // ------------- helpers -------------
  const mapPostingToJob = (p) => {
    const title = cleanText(p?.title) || "Unknown title";

    const location =
      cleanText(p?.locationsText) ||
      cleanText(p?.primaryLocation) ||
      null;

    const externalPath = p?.externalPath || p?.path || null;

    // Build job URL with the locale-aware human base
    const url = externalPath ? absoluteUrl(humanBase, externalPath) : humanBase;

    const desc =
      cleanText(p?.jobDescription) ||
      cleanText(p?.description) ||
      null;

    const postedAt = p?.postedOn || p?.postedDate || null;

    // Try to build a stable id
    const reqId =
      p?.bulletFields?.reqId ||
      p?.reqId ||
      p?.jobReqId ||
      null;

    const stableKey = reqId ? String(reqId) : (externalPath || url);
    const id = `${company.id}:${Buffer.from(stableKey).toString("base64url")}`;

    return {
      id,
      company,
      title,
      location,
      workplace: null, // enriched later
      employmentType: cleanText(p?.timeType) || null,
      department: cleanText(p?.jobFamily) || null,
      team: null,
      url,
      applyUrl: url,
      description: { text: desc, html: null },
      source: { kind: "workday_api", raw: { host, tenant, site } },
      postedAt,
      scrapedAt
    };
  };

  const extractPostings = (data) => {
    if (Array.isArray(data?.jobPostings)) return data.jobPostings;
    if (Array.isArray(data?.items)) return data.items;
    // some tenants: data.searchResults
    if (Array.isArray(data?.searchResults)) return data.searchResults;
    return [];
  };

  const extractTotal = (data) => {
    if (typeof data?.total === "number") return data.total;
    if (typeof data?.totalResults === "number") return data.totalResults;
    if (typeof data?.count === "number") return data.count;
    return null;
  };

  // ------------- POST pagination (try variants) -------------
  const payloadVariants = (offset) => ([
    // Variant A (common)
    { limit: pageSize, offset, searchText: "", appliedFacets: {} },

    // Variant B (some tenants require array)
    { limit: pageSize, offset, searchText: "", appliedFacets: [] },

    // Variant C (some tenants accept "filters")
    { limit: pageSize, offset, searchText: "", filters: {} },

    // Variant D (minimal)
    { limit: pageSize, offset, searchText: "" }
  ]);

  async function tryPostPaging() {
    let offset = 0;
    let total = null;
    const all = [];

    while (true) {
      let pageData = null;
      let lastErr = null;

      // try each payload shape until one works
      for (const bodyObj of payloadVariants(offset)) {
        try {
          pageData = await fetchJson(apiBase, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json,text/plain,*/*"
              // IMPORTANT: do NOT send Origin/Referer (some tenants 400 on mismatch)
            },
            body: JSON.stringify(bodyObj),
            timeoutMs: 25000,
            retries: 6
          });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          // try next variant
        }
      }

      if (!pageData) {
        // none of the payload variants worked
        throw lastErr || new Error("Workday POST failed for all payload variants");
      }

      const pageItems = extractPostings(pageData);
      if (total === null) total = extractTotal(pageData);

      if (!pageItems.length) break;

      all.push(...pageItems);
      offset += pageItems.length;

      if (all.length >= maxTotal) break;
      if (typeof total === "number" && offset >= total) break;
      if (pageItems.length < pageSize) break;
    }

    return { postings: all, total };
  }

  // ------------- GET fallback (no params) -------------
  async function tryGetOnce() {
    const data = await fetchJson(apiBase, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,*/*"
      },
      timeoutMs: 25000,
      retries: 6
    });

    return { postings: extractPostings(data), total: extractTotal(data) };
  }

  // ------------- run strategy -------------
  let postings = [];
  let total = null;

  try {
    const r = await tryPostPaging();
    postings = r.postings;
    total = r.total;
  } catch (e) {
    console.error(
      `[${company.id}] Workday POST paging failed; trying GET fallback (reason: ${e?.message || e})`
    );

    const r = await tryGetOnce();
    postings = r.postings;
    total = r.total;
  }

  const jobs = postings.map(mapPostingToJob);

  console.log(
    `[${company.id}] workday fetched=${postings.length} total=${total ?? "unknown"}`
  );

  return jobs;
}
