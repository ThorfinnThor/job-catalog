import { chromium } from "playwright";
import { cleanText, absoluteUrl, stripHtml } from "../lib/normalize.mjs";

const DEBUG = process.env.DEBUG_WORKDAY === "1";

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
    // 1) Load the human page (helps get baseline cookies / any redirects right)
    await page.goto(humanBase, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});

    const api = context.request;

    // 2) Bootstrap session + capture CSRF token if the tenant uses it.
    // Many tenants require X-Calypso-CSRF-Token + cookies, otherwise POST /jobs returns HTTP 400.
    const bootstrap = await bootstrapSession({ api, apiUrl, host, humanBase });

    if (DEBUG) {
      console.log(
        `[${company.id}] bootstrap: status=${bootstrap.status} csrf=${bootstrap.csrfToken ? "yes" : "no"}`
      );
    }

    // 3) Page through results via POST with canonical payload.
    const postings = [];
    let offset = 0;

    while (true) {
      const data = await fetchJobsPage({
        api,
        apiUrl,
        host,
        humanBase,
        csrfToken: bootstrap.csrfToken,
        limit: pageSize,
        offset
      });

      const pageItems = extractPostings(data);
      const total = extractTotal(data);

      if (DEBUG) {
        console.log(
          `[${company.id}] page: offset=${offset} got=${pageItems.length} total=${typeof total === "number" ? total : "?"}`
        );
      }

      if (!pageItems.length) break;

      postings.push(...pageItems);
      offset += pageItems.length;

      if (postings.length >= maxTotal) break;
      if (typeof total === "number" && offset >= total) break;
      if (pageItems.length < pageSize) break;
    }

    const jobs = await enrichDescriptionsWithDetails({
      api,
      csrfToken: bootstrap.csrfToken,
      host,
      humanBase,
      cxsBase,
      postings,
      company,
      scrapedAt,
      detailConcurrency
    });

    if (DEBUG) console.log(`[${company.id}] workday done: jobs=${jobs.length}`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * GET bootstrap to ensure cookies are set in this browser context and to read the CSRF token
 * header if the tenant enforces x-calypso-csrf-token.
 */
async function bootstrapSession({ api, apiUrl, host, humanBase }) {
  const headers = {
    accept: "application/json,text/plain,*/*",
    "accept-language": "en-US,en;q=0.9",
    origin: `https://${host}`,
    referer: humanBase,
    // content-type not necessary for GET
  };

  try {
    const res = await api.get(apiUrl, { headers });

    const status = res.status();
    // Playwright normalizes headers to lowercase keys
    const h = res.headers();
    const csrfToken =
      h["x-calypso-csrf-token"] ||
      h["x-calypso-csrf"] ||
      null;

    // Even if not ok, cookies might still be set (depends on tenant),
    // but in most cases this GET should be 200/204.
    return { status, csrfToken };
  } catch (e) {
    if (DEBUG) console.warn(`bootstrapSession failed: ${e?.message || e}`);
    return { status: -1, csrfToken: null };
  }
}

async function fetchJobsPage({ api, apiUrl, host, humanBase, csrfToken, limit, offset }) {
  const headers = {
    accept: "application/json,text/plain,*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json;charset=UTF-8",
    origin: `https://${host}`,
    referer: humanBase
  };

  if (csrfToken) headers["x-calypso-csrf-token"] = csrfToken;

  const payload = {
    appliedFacets: {},
    limit,
    offset,
    searchText: ""
  };

  const res = await api.post(apiUrl, { headers, data: payload });
  const txt = await res.text();

  if (!res.ok()) {
    // include body snippet, it often contains the Workday JSON error blob
    throw new Error(`HTTP ${res.status()} for ${apiUrl}\n${txt.slice(0, 1200)}`);
  }

  return JSON.parse(txt);
}

function extractPostings(data) {
  if (Array.isArray(data?.jobPostings)) return data.jobPostings;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.searchResults)) return data.searchResults;
  return [];
}

function extractTotal(data) {
  if (typeof data?.total === "number") return data.total;
  if (typeof data?.totalResults === "number") return data.totalResults;
  if (typeof data?.count === "number") return data.count;
  return null;
}

async function enrichDescriptionsWithDetails({
  api,
  csrfToken,
  host,
  humanBase,
  cxsBase,
  postings,
  company,
  scrapedAt,
  detailConcurrency
}) {
  // simple concurrency limiter
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

  const headersBase = {
    accept: "application/json,text/plain,*/*",
    "accept-language": "en-US,en;q=0.9",
    origin: `https://${host}`,
    referer: humanBase
  };
  if (csrfToken) headersBase["x-calypso-csrf-token"] = csrfToken;

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

        // Detail fetch
        if (externalPath && externalPath.startsWith("/job/")) {
          const detailUrl = `${cxsBase}${externalPath}`;
          try {
            const res = await api.get(detailUrl, { headers: headersBase });
            if (res.ok()) {
              const data = await res.json();
              const htmlDesc =
                data?.jobPostingInfo?.jobDescription ||
                data?.jobPostingInfo?.jobDescriptionText ||
                null;
              if (htmlDesc) descriptionText = stripHtml(htmlDesc);
            }
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
          source: { kind: "workday_cxs_session_post", raw: { externalPath } },
          postedAt,
          scrapedAt
        };
      })
    )
  );

  return jobs;
}
