import { fetchText } from "../lib/http.mjs";
import { cleanText, stripHtml, safeIsoDate, normalizeWorkplace, normalizeEmploymentType } from "../lib/normalize.mjs";

/**
 * Workday public "cxs" endpoints are the most stable way to scrape Workday.
 * This adapter tries common Workday patterns (GET then POST).
 *
 * Inputs:
 * - host: e.g. immatics.wd3.myworkdayjobs.com
 * - tenant: e.g. immatics
 * - site: e.g. Immatics_External
 */
export async function scrapeWorkday({ company, host, tenant, site, searchText = "", max = 250 }) {
  const scrapedAt = new Date().toISOString();

  const base = `https://${host}/wday/cxs/${tenant}/${site}`;
  const listUrl = `${base}/jobs`;

  async function getPage(offset, limit) {
    // Variant A: GET with query params (common)
    const urlA = `${listUrl}?offset=${offset}&limit=${limit}&searchText=${encodeURIComponent(searchText)}`;
    const a = await tryJson(urlA);
    if (a?.jobPostings) return a;

    // Variant B: POST with JSON body (common)
    const b = await tryPostJson(listUrl, {
      appliedFacets: {},
      searchText,
      limit,
      offset
    });
    if (b?.jobPostings) return b;

    // Variant C: some tenants use "query" instead of "searchText"
    const c = await tryPostJson(listUrl, {
      appliedFacets: {},
      query: searchText,
      limit,
      offset
    });
    if (c?.jobPostings) return c;

    return null;
  }

  async function tryJson(url) {
    try {
      const txt = await fetchText(url, {
        headers: {
          accept: "application/json,text/plain,*/*"
        }
      });
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }

  async function tryPostJson(url, body) {
    try {
      const txt = await fetchText(url, {
        headers: {
          accept: "application/json,text/plain,*/*",
          "content-type": "application/json"
        },
        // undici fetchText doesn't expose method; we use a hack via ?method override not possible.
      });
      // If GET only, above won't work; we implement POST via direct undici fetch here:
      return await postJson(url, body);
    } catch {
      try {
        return await postJson(url, body);
      } catch {
        return null;
      }
    }
  }

  async function postJson(url, body) {
    const { fetch } = await import("undici");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "application/json,text/plain,*/*",
        "content-type": "application/json",
        "accept-language": "en-US,en;q=0.8,de-DE;q=0.7,de;q=0.6"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} Workday POST`);
    return await res.json();
  }

  const jobs = [];
  const seen = new Set();

  let offset = 0;
  const limit = 20;

  while (jobs.length < max) {
    const page = await getPage(offset, limit);
    if (!page || !Array.isArray(page.jobPostings) || page.jobPostings.length === 0) break;

    for (const jp of page.jobPostings) {
      const id = cleanText(jp.externalPath ?? jp.bulletFields?.[0] ?? jp?.jobReqId ?? "");
      const externalPath = jp.externalPath ? `${base}${jp.externalPath}` : null;
      const postingUrl = externalPath || jp?.url || null;

      if (!postingUrl) continue;
      if (seen.has(postingUrl)) continue;
      seen.add(postingUrl);

      const title = cleanText(jp.title);
      const loc = cleanText(jp.locationsText || (Array.isArray(jp.locations) ? jp.locations.join(", ") : jp.location) || "");

      // Attempt to get detail via /job/<...> which is HTML; better: the detail JSON endpoint.
      // Some tenants provide: /job/<id> or /job/<...> as HTML; this adapter keeps description minimal unless we can fetch JSON.
      let descriptionText = null;

      // Try detail endpoint patterns
      const detailCandidates = [];
      // jp.externalPath looks like "/job/Tuebingen-Germany/Medical-Monitor-_JR100587"
      if (jp.externalPath) detailCandidates.push(`${base}${jp.externalPath}`);
      // JSON detail pattern often: /job/<reqId>
      if (jp?.jobReqId) detailCandidates.push(`${base}/job/${jp.jobReqId}`);

      for (const du of detailCandidates) {
        const dj = await tryJson(du);
        if (dj?.jobPostingInfo?.jobDescription) {
          descriptionText = stripHtml(dj.jobPostingInfo.jobDescription);
          break;
        }
      }

      jobs.push({
        id: jp?.bulletFields?.find((x) => String(x).startsWith("JR")) ? `workday:${jp.bulletFields.find((x) => String(x).startsWith("JR"))}` : `workday:${Buffer.from(postingUrl).toString("base64url")}`,
        company,
        title: title || "Unknown title",
        location: loc || null,
        workplace: normalizeWorkplace(loc),
        employmentType: normalizeEmploymentType(jp?.timeType ?? jp?.categoriesText ?? ""),
        department: cleanText(jp?.jobFamily ?? jp?.category ?? ""),
        team: null,
        url: postingUrl,
        applyUrl: postingUrl,
        description: { text: descriptionText, html: null },
        source: { kind: "workday_api", raw: { externalPath: jp.externalPath } },
        postedAt: safeIsoDate(jp?.postedOn ?? jp?.postedDate ?? null),
        scrapedAt
      });
    }

    offset += page.jobPostings.length;
    if (page.jobPostings.length < limit) break;
  }

  return jobs;
}
