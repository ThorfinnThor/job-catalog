import { fetchTextWithCookies, fetchJson } from "../lib/http.mjs";
import { cleanText, absoluteUrl } from "../lib/normalize.mjs";

/**
 * Robust Workday adapter:
 * - Prime cookies by loading the human careers page first (many tenants require this)
 * - Call /wday/cxs/.../jobs with cookie + browser-like headers
 * - Try POST paging with several payload variants
 * - If POST paging fails, try GET once (capped list for some tenants)
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

  // Human base for referer + link building (prefer locale path)
  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");

  // API endpoint
  const apiBase = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

  // 1) PRIME COOKIES (this is the critical fix)
  let cookieJar = "";
  try {
    const primed = await fetchTextWithCookies(humanBase, cookieJar, {
      method: "GET",
      timeoutMs: 25000,
      retries: 3
    });
    if (primed.cookies?.length) cookieJar = mergeCookies(cookieJar, primed.cookies);
  } catch (e) {
    // If priming fails, still try API; some tenants don't need cookies.
    console.error(`[${company.id}] workday prime failed (continuing): ${e?.message || e}`);
  }

  const baseHeaders = {
    accept: "application/json,text/plain,*/*",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    origin: `https://${host}`,
    referer: `${humanBase}/`,
    ...(cookieJar ? { cookie: cookieJar } : {})
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

  const mapPostingToJob = (p) => {
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
      workplace: null,
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

  const payloadVariants = (offset) => ([
    // Common shapes across tenants
    { limit: pageSize, offset, searchText: "", appliedFacets: {} },
    { limit: pageSize, offset, searchText: "", appliedFacets: [] },
    { limit: pageSize, offset, searchText: "" },
    // Some tenants are picky about empty strings vs null
    { limit: pageSize, offset, searchText: null, appliedFacets: {} },
  ]);

  async function tryPostPaging() {
    let offset = 0;
    let total = null;
    const all = [];

    while (true) {
      let pageData = null;
      let lastErr = null;

      for (const bodyObj of payloadVariants(offset)) {
        try {
          pageData = await fetchJson(apiBase, {
            method: "POST",
            headers: baseHeaders,
            body: JSON.stringify(bodyObj),
            timeoutMs: 25000,
            retries: 4
          });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }

      if (!pageData) throw lastErr || new Error("Workday POST failed for all payload variants");

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

  async function tryGetOnce() {
    // Some tenants allow GET but cap results. Still needs cookies/headers.
    const data = await fetchJson(apiBase, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,*/*",
        "x-requested-with": "XMLHttpRequest",
        origin: `https://${host}`,
        referer: `${humanBase}/`,
        ...(cookieJar ? { cookie: cookieJar } : {})
      },
      timeoutMs: 25000,
      retries: 4
    });

    return { postings: extractPostings(data), total: extractTotal(data) };
  }

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

  console.log(`[${company.id}] workday fetched=${postings.length} total=${total ?? "unknown"}`);
  return jobs;
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
