import { chromium } from "playwright";
import { cleanText, absoluteUrl, stripHtml } from "../lib/normalize.mjs";

const DEBUG = process.env.DEBUG_WORKDAY === "1";

/**
 * Workday scraper that avoids HTTP 400 by performing the API calls from inside the
 * browser page context (page.evaluate(fetch...)), instead of using context.request.
 *
 * Many Workday tenants accept the browser's own XHR/fetch but reject "APIRequestContext"
 * replays with HTTP 400 due to subtle cookie/CSRF/session/header requirements.
 */
export async function scrapeWorkday({
  company,
  host,
  tenant,
  site,
  pageSize = 200,
  maxTotal = 5000,
  detailConcurrency = 6
}) {
  const scrapedAt = new Date().toISOString();

  const apiPath = `/wday/cxs/${tenant}/${site}/jobs`;
  const apiUrl = `https://${host}${apiPath}`;

  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");
  const cxsBase = `https://${host}/wday/cxs/${tenant}/${site}`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    // 1) Capture the real in-browser Workday /jobs request + response
    const capture = await captureInitialJobsCall({ page, humanBase, apiPath });

    if (DEBUG) {
      console.log(`[${company.id}] captured jobs call: method=${capture.method} url=${capture.url}`);
      console.log(`[${company.id}] captured header keys: ${Object.keys(capture.headers).sort().join(", ")}`);
      if (capture.kind === "json") console.log(`[${company.id}] captured body keys: ${Object.keys(capture.body || {}).join(", ")}`);
    }

    // 2) Use the captured request template to paginate IN-PAGE via fetch()
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
    let total = null;
    let offset = 0;

    // First page data comes from the captured successful response
    {
      const data = capture.data;
      const pageItems = extractPostings(data);
      total = extractTotal(data);

      postings.push(...pageItems);
      offset += pageItems.length;
    }

    while (true) {
      if (postings.length >= maxTotal) break;
      if (typeof total === "number" && offset >= total) break;

      const data = await fetchJobsPageInPage({
        page,
        requestTemplate: capture,
        apiUrlFallback: apiUrl,
        offset,
        limit: pageSize
      });

      const pageItems = extractPostings(data);
      if (total === null) total = extractTotal(data);

      if (DEBUG) {
        console.log(
          `[${company.id}] page offset=${offset} got=${pageItems.length} total=${typeof total === "number" ? total : "?"}`
        );
      }

      if (!pageItems.length) break;

      postings.push(...pageItems);
      offset += pageItems.length;

      if (pageItems.length < pageSize) break;
    }

    // 3) Fetch job details (descriptions) also using in-page fetch to avoid 400s
    const jobs = await enrichDescriptionsWithDetailsInPage({
      page,
      requestTemplate: capture,
      cxsBase,
      postings,
      company,
      humanBase,
      scrapedAt,
      detailConcurrency
    });

    if (DEBUG) console.log(`[${company.id}] workday jobs=${jobs.length}`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function captureInitialJobsCall({ page, humanBase, apiPath }) {
  // We want the *successful* response that the page itself uses.
  // Capture request+headers+body from the matching response.request().
  const isJobs = (urlStr) => {
    try {
      const u = new URL(urlStr);
      return u.pathname === apiPath;
    } catch {
      return false;
    }
  };

  await page.goto(humanBase, { waitUntil: "domcontentloaded", timeout: 60000 });

  const resp = await page.waitForResponse(
    (r) => isJobs(r.url()) && r.status() >= 200 && r.status() < 300,
    { timeout: 60000 }
  );

  const req = resp.request();
  const method = (req.method() || "").toUpperCase();
  const url = req.url();

  const headers = filterHeadersForBrowserFetch(req.headers());
  const postData = req.postData();

  // Parse body if JSON
  let kind = "none";
  let body = null;

  if (method === "POST" && postData && postData.trim()) {
    try {
      body = JSON.parse(postData);
      kind = "json";
    } catch {
      // Workday is almost always JSON here, but keep a fallback.
      kind = "raw";
      body = postData;
    }
  }

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Workday returned non-JSON for initial /jobs response: ${text.slice(0, 400)}`);
  }

  return { method, url, headers, kind, body, data };
}

/**
 * Update offset/limit in the request body.
 * Different tenants use slightly different shapes; cover the common ones.
 */
function setOffsetAndLimitInBody(body, offset, limit) {
  if (!body || typeof body !== "object") return;

  // Most common
  body.offset = offset;
  body.limit = limit;

  // Some variants
  if (typeof body.count === "number") body.count = limit;
  if (typeof body.pageSize === "number") body.pageSize = limit;
  if (typeof body.start === "number") body.start = offset;
}

async function fetchJobsPageInPage({ page, requestTemplate, apiUrlFallback, offset, limit }) {
  const url = requestTemplate.url || apiUrlFallback;

  if (requestTemplate.method !== "POST") {
    // Extremely rare; still support by appending query params.
    const u = new URL(url);
    u.searchParams.set("offset", String(offset));
    u.searchParams.set("limit", String(limit));
    const res = await pageFetchJson(page, u.toString(), {
      method: "GET",
      headers: requestTemplate.headers
    });
    return res;
  }

  if (requestTemplate.kind !== "json" || !requestTemplate.body || typeof requestTemplate.body !== "object") {
    throw new Error(`Captured Workday /jobs POST did not have a JSON body. Cannot paginate safely.`);
  }

  const body = deepClone(requestTemplate.body);
  setOffsetAndLimitInBody(body, offset, limit);

  const res = await pageFetchJson(page, url, {
    method: "POST",
    headers: {
      ...requestTemplate.headers,
      "content-type": "application/json;charset=UTF-8"
    },
    body: JSON.stringify(body)
  });

  return res;
}

async function enrichDescriptionsWithDetailsInPage({
  page,
  requestTemplate,
  cxsBase,
  postings,
  company,
  humanBase,
  scrapedAt,
  detailConcurrency
}) {
  // Concurrency limiter
  const queue = [];
  let active = 0;

  const run = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });

  const pump = () => {
    while (active < detailConcurrency && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  // Use the same header set used by the jobs request (safe subset)
  const headers = requestTemplate.headers || {};

  const jobs = await Promise.all(
    postings.map((p) =>
      run(async () => {
        const title = cleanText(p?.title) || "Unknown title";
        const location =
          cleanText(p?.locationsText) ||
          cleanText(p?.primaryLocation) ||
          null;

        const externalPath = p?.externalPath || p?.path || null;
        const url = externalPath ? absoluteUrl(humanBase, externalPath) : humanBase;

        const postedAt = p?.postedOn || p?.postedDate || null;

        const reqId =
          p?.bulletFields?.reqId ||
          p?.reqId ||
          p?.jobReqId ||
          null;

        const stableKey = reqId ? String(reqId) : (externalPath || url);
        const id = `${company.id}:${Buffer.from(stableKey).toString("base64url")}`;

        let descriptionText =
          cleanText(p?.jobDescription) ||
          cleanText(p?.description) ||
          null;

        if (externalPath && externalPath.startsWith("/job/")) {
          const detailUrl = `${cxsBase}${externalPath}`;

          try {
            const data = await pageFetchJson(page, detailUrl, {
              method: "GET",
              headers
            });

            const htmlDesc =
              data?.jobPostingInfo?.jobDescription ||
              data?.jobPostingInfo?.jobDescriptionText ||
              null;

            if (htmlDesc) descriptionText = stripHtml(htmlDesc);
          } catch {
            // ignore detail failures
          }
        }

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
          source: { kind: "workday_inpage_fetch", raw: { externalPath } },
          postedAt,
          scrapedAt
        };
      })
    )
  );

  return jobs;
}

/**
 * Perform fetch in the page context so cookies/CSRF/session match what Workday expects.
 * Returns parsed JSON or throws with a useful error body snippet.
 */
async function pageFetchJson(page, url, { method, headers, body }) {
  const result = await page.evaluate(async ({ url, method, headers, body }) => {
    const res = await fetch(url, {
      method,
      headers,
      body,
      credentials: "same-origin"
    });

    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text
    };
  }, { url, method, headers, body });

  if (!result.ok) {
    throw new Error(`HTTP ${result.status} for ${url}\n${result.text.slice(0, 1200)}`);
  }

  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error(`Non-JSON response for ${url}\n${result.text.slice(0, 1200)}`);
  }
}

/**
 * Only keep headers that are safe/meaningful to set in browser fetch.
 * (Many request headers are forbidden to set programmatically.)
 */
function filterHeadersForBrowserFetch(h) {
  const out = {};
  const allow = new Set([
    "accept",
    "accept-language",
    "content-type",
    "x-calypso-csrf-token",
    "x-workday-client",
    "x-workday-application",
    "x-workday-user-agent",
    "x-wday-tenant",
    "x-wday-device",
    "x-wday-timezone",
    "x-wday-timezone-offset"
  ]);

  for (const [k, v] of Object.entries(h || {})) {
    const key = String(k).toLowerCase();
    if (allow.has(key)) out[key] = v;
  }

  // Ensure we ask for JSON
  if (!out["accept"]) out["accept"] = "application/json,text/plain,*/*";

  return out;
}

function deepClone(x) {
  return x ? JSON.parse(JSON.stringify(x)) : x;
}
