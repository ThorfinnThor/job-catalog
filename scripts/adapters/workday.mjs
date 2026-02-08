import { cleanText, absoluteUrl } from "../lib/normalize.mjs";

/**
 * Workday CXS adapter with robust POST fallbacks + pagination.
 *
 * Endpoint:
 *   https://{host}/wday/cxs/{tenant}/{site}/jobs
 *
 * Pagination:
 *   offset + limit (in POST body)
 *
 * Critical: Some tenants accept JSON bodies, others require x-www-form-urlencoded.
 * This adapter tries:
 *  - JSON body w/ appliedFacets {}
 *  - JSON body w/ appliedFacets []
 *  - FORM body (x-www-form-urlencoded) with appliedFacets="{}" / "[]"
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
  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");

  const baseHeaders = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "x-requested-with": "XMLHttpRequest",
    // Browser-ish UA helps some tenants
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

  async function postJson(bodyObj) {
    return await fetchJsonWithRetries(apiUrl, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json;charset=UTF-8"
      },
      body: JSON.stringify(bodyObj)
    });
  }

  async function postForm(bodyObj, appliedFacetsValue) {
    // Workday sometimes expects "appliedFacets" as a stringified JSON value in form body.
    const params = new URLSearchParams();
    params.set("limit", String(bodyObj.limit));
    params.set("offset", String(bodyObj.offset));
    params.set("searchText", bodyObj.searchText ?? "");
    params.set("appliedFacets", appliedFacetsValue);

    return await fetchJsonWithRetries(apiUrl, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: params.toString()
    });
  }

  async function fetchPage(offset) {
    const baseBody = { limit: pageSize, offset, searchText: "" };

    // Try variants in order; stop at first success
    const variants = [
      () => postJson({ ...baseBody, appliedFacets: {} }),
      () => postJson({ ...baseBody, appliedFacets: [] }),
      () => postForm({ ...baseBody }, "{}"),
      () => postForm({ ...baseBody }, "[]")
    ];

    let lastErr = null;
    for (const v of variants) {
      try {
        return await v();
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error("All Workday POST variants failed");
  }

  const postings = [];
  let offset = 0;
  let total = null;

  while (true) {
    const data = await fetchPage(offset);

    const page = extractPostings(data);
    if (total === null) total = extractTotal(data);

    if (!page.length) break;

    postings.push(...page);
    offset += page.length;

    if (postings.length >= maxTotal) break;
    if (typeof total === "number" && offset >= total) break;

    // If Workday gives fewer than requested, likely last page
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

/**
 * Minimal fetch+json helper with retries (self-contained so we don't depend on your http.mjs internals)
 */
async function fetchJsonWithRetries(url, init, retries = 5) {
  let lastErr = null;

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, init);
      const txt = await res.text();

      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}\n${txt}`);
        err.status = res.status;
        throw err;
      }

      // Workday returns JSON
      return JSON.parse(txt);
    } catch (e) {
      lastErr = e;
      // simple backoff
      await sleep(400 * (i + 1));
    }
  }

  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
