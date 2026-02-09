import { fetchJson } from "./lib/http.mjs";
import { cleanText, absoluteUrl } from "./lib/normalize.mjs";

/**
 * Workday adapter (simple / stable)
 * - Single GET request to the CXS endpoint
 * - Most tenants return up to ~500 postings (server-side cap)
 * - This is the version that tends to "just work"
 */
export async function scrapeWorkday({ company, host, tenant, site }) {
  const scrapedAt = new Date().toISOString();

  const apiUrl = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

  // Use careersUrl for building clickable job URLs
  // Expect careersUrl like: https://<host>/en-US/<site>
  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");

  const data = await fetchJson(apiUrl, {
    method: "GET",
    headers: {
      accept: "application/json,text/plain,*/*",
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

    const descriptionText =
      cleanText(p?.jobDescription) ||
      cleanText(p?.description) ||
      null;

    const postedAt = p?.postedOn || p?.postedDate || null;

    // stable-ish identifier (not always present)
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
      description: { text: descriptionText, html: null },
      source: { kind: "workday_api", raw: { host, tenant, site } },
      postedAt,
      scrapedAt
    };
  });

  console.log(`[${company.id}] workday fetched=${jobs.length} (likely capped)`);
  return jobs;
}
