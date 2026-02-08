import { fetchJson } from "../lib/http.mjs";
import { cleanText } from "../lib/normalize.mjs";

/**
 * Workday CXS API adapter
 * Endpoint pattern:
 *   https://{host}/wday/cxs/{tenant}/{site}/jobs
 *
 * Pagination (common):
 *   ?offset=0&limit=20
 * Some tenants default to 20/50/100; some accept bigger.
 *
 * We paginate until:
 *  - returned list is empty OR
 *  - we reached "total" if provided OR
 *  - we hit maxTotal safety cap
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

  const base = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

  let offset = 0;
  let total = null;
  const items = [];

  while (true) {
    const url = new URL(base);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(pageSize));

    const data = await fetchJson(url.toString(), {
      headers: {
        accept: "application/json,text/plain,*/*",
      },
      timeoutMs: 25000,
      retries: 6
    });

    // Workday tenants vary: "jobPostings" is common; sometimes "items"
    const pageItems =
      Array.isArray(data?.jobPostings) ? data.jobPostings :
      Array.isArray(data?.items) ? data.items :
      [];

    // Total can appear as total, totalResults, or in some nested field
    if (total === null) {
      total =
        (typeof data?.total === "number" ? data.total : null) ??
        (typeof data?.totalResults === "number" ? data.totalResults : null) ??
        null;
    }

    if (!pageItems.length) break;

    items.push(...pageItems);

    offset += pageItems.length;

    // Stop conditions
    if (offset >= maxTotal) break;
    if (typeof total === "number" && offset >= total) break;

    // If Workday returns fewer than requested, likely last page
    if (pageItems.length < pageSize) break;
  }

  // Convert to unified job objects and fetch details (optional but recommended)
  const jobs = [];
  for (const p of items) {
    const id = p?.bulletFields?.reqId || p?.externalPath || p?.id || null;

    const title = cleanText(p?.title) || "Unknown title";
    const location = cleanText(p?.locationsText) || cleanText(p?.primaryLocation) || null;

    // Human job URL
    // externalPath typically looks like "/job/City-Country/Title_REQID"
    const externalPath = p?.externalPath || p?.path || null;
    const jobUrl = externalPath
      ? `https://${host}/${site}${externalPath.startsWith("/") ? "" : "/"}${externalPath}`
      : `https://${host}/${site}`;

    // Workday details endpoint commonly:
    // https://{host}/wday/cxs/{tenant}/{site}/job/{externalPathParts...}
    // BUT each tenant varies; we already get a decent "jobDescription" in many listings.
    const desc =
      cleanText(p?.jobDescription) ||
      cleanText(p?.description) ||
      null;

    const jobId = id ? String(id) : Buffer.from(jobUrl).toString("base64url");

    jobs.push({
      id: `${company.id}:${jobId}`,
      company,
      title,
      location,
      workplace: null,
      employmentType: cleanText(p?.timeType) || null,
      department: cleanText(p?.jobFamily) || null,
      team: null,
      url: jobUrl,
      applyUrl: jobUrl,
      description: { text: desc, html: null },
      source: { kind: "workday_api", raw: { host, tenant, site } },
      postedAt: p?.postedOn || p?.postedDate || null,
      scrapedAt
    });
  }

  console.log(
    `[${company.id}] workday fetched=${items.length} (offset=${offset}, total=${total ?? "unknown"})`
  );

  return jobs;
}
