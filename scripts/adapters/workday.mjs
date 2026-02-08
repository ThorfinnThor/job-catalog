import { fetchJson } from "../lib/http.mjs";
import { cleanText, absoluteUrl } from "../lib/normalize.mjs";

/**
 * Workday CXS job search
 * Most tenants expect:
 *   POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 * with JSON body like:
 *   {"appliedFacets":[],"limit":50,"offset":0,"searchText":""}
 *
 * Pagination = increase offset in the BODY (not query string).
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

  const apiUrl = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

  // Important: use a locale human URL for Referer/Origin consistency
  // If you set careersUrl in sites.mjs, we use it; otherwise guess en-US.
  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");

  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json;charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
    "accept-language": "en-US,en;q=0.9",
    // Workday tenants often behave better with a browser UA
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    origin: `https://${host}`,
    referer: `${humanBase}/`
  };

  const extractPostings = (data) => {
    if (Array.isArray(data?.jobPostings)) return data.jobPostings;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.searchResults)) return data.searchResults;
    return [];
  };

  const extractTotal = (data) => {
    if (typeof data?.total === "number") return data.total;
    if (typeof data?.totalResults === "number") return data.totalResults;
    if (typeof data?.count === "number") return data.count;
    return null;
  };

  const postings = [];
  let offset = 0;
  let total = null;

  while (true) {
    // ✅ key compatibility detail: appliedFacets MUST be an array for many tenants
    const body = {
      appliedFacets: [],
      limit: pageSize,
      offset,
      searchText: ""
    };

    const data = await fetchJson(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: 30000,
      retries: 6
    });

    const page = extractPostings(data);
    if (total === null) total = extractTotal(data);

    if (!page.length) break;

    postings.push(...page);
    offset += page.length;

    if (postings.length >= maxTotal) break;
    if (typeof total === "number" && offset >= total) break;
    if (page.length < pageSize) break;
  }

  const jobs = postings.map((p) => {
    const title = cleanText(p?.title) || "Unknown title";

    const location =
      cleanText(p?.locationsText) ||
      cleanText(p?.primaryLocation) ||
      null;

    const externalPath = p?.externalPath || p?.path || null;
    const url = externalPath ? absoluteUrl(humanBase, externalPath) : humanBase;

    const desc =
      cleanText(p?.jobDescription) ||
      cleanText(p?.description) ||
      null;

    const postedAt = p?.postedOn || p?.postedDate || null;

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
      workplace: null, // enriched later in scrape-jobs.mjs
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
  });

  console.log(`[${company.id}] workday fetched=${postings.length} total=${total ?? "unknown"}`);
  return jobs;
}
