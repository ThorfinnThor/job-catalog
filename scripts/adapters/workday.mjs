import { fetchJson } from "../lib/http.mjs";
import { cleanText, absoluteUrl } from "../lib/normalize.mjs";

/**
 * Workday CXS adapter (stable mode)
 *
 * Uses the simplest call that tends to work across tenants:
 *   GET https://{host}/wday/cxs/{tenant}/{site}/jobs
 *
 * Many tenants cap this to ~500 results. That's OK for now; it gets the pipeline working again.
 * We can add tenant-specific pagination later once we inspect real response shapes.
 */
export async function scrapeWorkday({ company, host, tenant, site }) {
  const scrapedAt = new Date().toISOString();

  const apiUrl = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");

  const data = await fetchJson(apiUrl, {
    method: "GET",
    headers: {
      accept: "application/json,text/plain,*/*",
      // Keep headers minimal; some tenants reject "too clever" headers.
      "accept-language": "en-US,en;q=0.9"
    },
    timeoutMs: 30000,
    retries: 6
  });

  const postings =
    Array.isArray(data?.jobPostings) ? data.jobPostings :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(data?.searchResults) ? data.searchResults :
    [];

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

  console.log(`[${company.id}] workday fetched=${jobs.length} (stable mode; may be capped)`);
  return jobs;
}
