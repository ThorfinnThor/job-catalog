import { chromium } from "playwright";
import { cleanText, absoluteUrl } from "../lib/normalize.mjs";

/**
 * Workday adapter (robust):
 * 1) Load the human careers page in Playwright
 * 2) Wait for the site's own XHR/fetch request to /wday/cxs/.../jobs
 * 3) Capture method + headers + postData
 * 4) Replay via context.request with only offset/limit changed
 *
 * This avoids guessing the payload format (JSON vs form, facets shape, etc.)
 * and works across many tenant variations.
 */
export async function scrapeWorkday({
  company,
  host,
  tenant,
  site,
  pageSize = 200,
  maxTotal = 5000
}) {
  const scrapedAt = new Date().toISOString();

  const apiPath = `/wday/cxs/${tenant}/${site}/jobs`;
  const apiUrl = `https://${host}${apiPath}`;

  const humanBase = (company.careersUrl || `https://${host}/en-US/${site}`).replace(/\/+$/, "");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    // Capture the FIRST jobs request the site itself makes
    const requestPromise = page.waitForRequest(
      (req) => {
        const url = req.url();
        return url.includes(apiPath);
      },
      { timeout: 60000 }
    );

    await page.goto(humanBase, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Some sites only fire jobs XHR after a moment
    const firstReq = await requestPromise;

    const captured = await captureWorkdayRequest(firstReq);

    // Use Playwright's APIRequestContext bound to the same browser context
    // => shares cookies/session automatically
    const api = context.request;

    // Fetch first page using captured request as-is (so we also validate it)
    const firstData = await replay(api, captured, apiUrl);

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

    let postings = [];
    let total = extractTotal(firstData);
    let pageItems = extractPostings(firstData);
    postings.push(...pageItems);

    // Determine whether the captured payload has offset/limit we can edit
    // If not, we still return the first page (often capped, but not 0)
    const canPage = captured.kind === "json" || captured.kind === "form";

    let offset = getOffset(captured);
    if (offset === null) offset = postings.length; // default assumption

    while (canPage) {
      if (postings.length >= maxTotal) break;
      if (typeof total === "number" && postings.length >= total) break;

      // If the first page is already smaller than pageSize, likely last page
      if (postings.length > 0 && pageItems.length < pageSize) break;

      // bump offset
      setOffsetAndLimit(captured, offset, pageSize);

      const data = await replay(api, captured, apiUrl);
      pageItems = extractPostings(data);

      if (!pageItems.length) break;

      postings.push(...pageItems);
      offset += pageItems.length;

      if (typeof total !== "number") {
        const t2 = extractTotal(data);
        if (typeof t2 === "number") total = t2;
      }
    }

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
        description: { text: descriptionText, html: null },
        source: { kind: "workday_capture_replay", raw: { host, tenant, site } },
        postedAt,
        scrapedAt
      };
    });

    console.log(`[${company.id}] workday fetched=${jobs.length} (capture+replay)`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** Capture method/headers/body from the site's own request */
async function captureWorkdayRequest(req) {
  const method = req.method();
  const headers = sanitizeHeaders(req.headers());
  const postData = req.postData();

  // Determine payload kind
  if (postData) {
    // try JSON
    try {
      const json = JSON.parse(postData);
      return { method, headers, kind: "json", json };
    } catch {
      // try x-www-form-urlencoded
      try {
        const params = new URLSearchParams(postData);
        const form = {};
        for (const [k, v] of params.entries()) form[k] = v;
        return { method, headers, kind: "form", form };
      } catch {
        return { method, headers, kind: "raw", raw: postData };
      }
    }
  }

  return { method, headers, kind: "none" };
}

/** Replay using the captured request structure via Playwright APIRequestContext */
async function replay(api, captured, url) {
  const headers = { ...captured.headers };

  // Avoid headers that break APIRequestContext
  delete headers["content-length"];
  delete headers["host"];

  let res;
  if (captured.method === "POST") {
    if (captured.kind === "json") {
      headers["content-type"] = headers["content-type"] || "application/json;charset=UTF-8";
      res = await api.post(url, { headers, data: captured.json });
    } else if (captured.kind === "form") {
      headers["content-type"] = headers["content-type"] || "application/x-www-form-urlencoded; charset=UTF-8";
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(captured.form)) params.set(k, String(v));
      res = await api.post(url, { headers, data: params.toString() });
    } else if (captured.kind === "raw") {
      res = await api.post(url, { headers, data: captured.raw });
    } else {
      res = await api.post(url, { headers });
    }
  } else {
    res = await api.get(url, { headers });
  }

  const txt = await res.text();
  if (!res.ok()) {
    throw new Error(`HTTP ${res.status()} for ${url}\n${txt.slice(0, 800)}`);
    // if needed we can also log headers, but keep it small.
  }

  return JSON.parse(txt);
}

/** Strip headers that are often problematic / unnecessary */
function sanitizeHeaders(h) {
  const out = { ...h };
  // keep minimal-ish but include what Workday expects
  // remove compression-specific headers; Playwright will handle this
  delete out["accept-encoding"];
  delete out["content-length"];
  return out;
}

function getOffset(captured) {
  if (captured.kind === "json") {
    const v = captured.json?.offset;
    return typeof v === "number" ? v : null;
  }
  if (captured.kind === "form") {
    const v = captured.form?.offset;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function setOffsetAndLimit(captured, offset, limit) {
  if (captured.kind === "json") {
    if (typeof captured.json !== "object" || captured.json === null) return;
    captured.json.offset = offset;
    captured.json.limit = limit;
    // Some tenants use "count" instead of "limit"
    if ("count" in captured.json && typeof captured.json.count === "number") captured.json.count = limit;
    return;
  }

  if (captured.kind === "form") {
    captured.form.offset = String(offset);
    captured.form.limit = String(limit);
    if ("count" in captured.form) captured.form.count = String(limit);
    return;
  }
}
