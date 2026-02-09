import { chromium } from "playwright";
import { cleanText, absoluteUrl, stripHtml } from "../lib/normalize.mjs";

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
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    // Workday job search endpoints frequently do a CORS preflight (OPTIONS) before the
    // actual jobs fetch (typically a POST with JSON body). If we accidentally capture the
    // preflight (or a lightweight GET without parameters) and replay it, Workday replies
    // with HTTP 400 (exactly what you're seeing across multiple tenants).
    //
    // To make this robust across tenants and avoid races, we record all matching requests
    // during page load, then pick the first *real* data request (POST-with-body), with a
    // safe fallback to a GET if a tenant truly uses GET.
    const candidates = [];
    const onReq = (req) => {
      if (isWorkdayJobsAnyRequest(req, apiPath)) candidates.push(req);
    };
    page.on("request", onReq);

    await page.goto(humanBase, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});

    page.off("request", onReq);

    const firstReq =
      candidates.find((r) => isWorkdayJobsDataRequest(r, apiPath)) ||
      candidates.find((r) => isWorkdayJobsAnyRequest(r, apiPath));

    if (!firstReq) {
      throw new Error(`No Workday jobs request observed on ${humanBase} (path=${apiPath}).`);
    }

    const captured = await captureWorkdayRequest(firstReq);

    // Force our desired page size BEFORE the first replay
    // (fixes the "always 20" problem)
    setOffsetAndLimit(captured, 0, pageSize);

    const api = context.request;

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

    while (true) {
      setOffsetAndLimit(captured, offset, pageSize);

      const data = await replay(api, captured, captured.url || apiUrl);
      const pageItems = extractPostings(data);

      if (total === null) total = extractTotal(data);

      if (!pageItems.length) break;

      postings.push(...pageItems);
      offset += pageItems.length;

      if (postings.length >= maxTotal) break;
      if (typeof total === "number" && offset >= total) break;

      // IMPORTANT: compare against the actual limit we requested (pageSize)
      if (pageItems.length < pageSize) break;
    }

    // ---- Fetch job detail JSON for descriptions (critical for EN/DE filter) ----
    // Workday detail endpoint usually works at:
    //   https://{host}/wday/cxs/{tenant}/{site}{externalPath}
    // where externalPath is like "/job/City-Country/Title_JR123"
    const jobs = await enrichDescriptionsWithDetails({
      api,
      captured,
      cxsBase,
      postings,
      company,
      humanBase,
      scrapedAt,
      detailConcurrency
    });

    console.log(`[${company.id}] workday fetched=${jobs.length} (capture+replay+paged+details)`);
    return jobs;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function enrichDescriptionsWithDetails({
  api,
  captured,
  cxsBase,
  postings,
  company,
  humanBase,
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

        // Default description from listing (often empty)
        let descriptionText =
          cleanText(p?.jobDescription) ||
          cleanText(p?.description) ||
          null;

        // If externalPath looks like /job/..., try detail JSON at CXS base + externalPath
        if (externalPath && externalPath.startsWith("/job/")) {
          const detailUrl = `${cxsBase}${externalPath}`;

          try {
            // Detail endpoints are typically GET and return JSON
            const res = await api.get(detailUrl, {
              headers: {
                accept: "application/json,text/plain,*/*",
                ...(captured.headers || {})
              }
            });

            if (res.ok()) {
              const data = await res.json();
              const htmlDesc =
                data?.jobPostingInfo?.jobDescription ||
                data?.jobPostingInfo?.jobDescriptionText ||
                null;

              if (htmlDesc) {
                descriptionText = stripHtml(htmlDesc);
              }
            }
          } catch {
            // ignore detail failures; keep listing desc if any
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
          source: { kind: "workday_capture_replay", raw: { externalPath } },
          postedAt,
          scrapedAt
        };
      })
    )
  );

  return jobs;
}

function isWorkdayJobsAnyRequest(req, apiPath) {
  try {
    const u = new URL(req.url());
    if (u.pathname !== apiPath) return false;
    const m = (req.method() || "").toUpperCase();
    // Exclude CORS preflight and other non-data methods.
    return m === "POST" || m === "GET";
  } catch {
    return false;
  }
}

function isWorkdayJobsDataRequest(req, apiPath) {
  try {
    const u = new URL(req.url());
    if (u.pathname !== apiPath) return false;
    const m = (req.method() || "").toUpperCase();
    if (m === "POST") {
      const body = req.postData();
      return Boolean(body && body.trim());
    }
    // Some tenants do GET with query params; treat as data only if it looks paginated.
    if (m === "GET") {
      return u.searchParams.has("offset") || u.searchParams.has("limit") || u.searchParams.has("page");
    }
    return false;
  } catch {
    return false;
  }
}

async function captureWorkdayRequest(req) {
  const url = req.url();
  const method = req.method();
  const headers = sanitizeHeaders(req.headers());
  const postData = req.postData();

  if (postData && postData.trim()) {
    try {
      const json = JSON.parse(postData);
      return { url, method, headers, kind: "json", json };
    } catch {
      try {
        const params = new URLSearchParams(postData);
        const form = {};
        for (const [k, v] of params.entries()) form[k] = v;
        return { url, method, headers, kind: "form", form };
      } catch {
        return { url, method, headers, kind: "raw", raw: postData };
      }
    }
  }

  return { url, method, headers, kind: "none" };
}

async function replay(api, captured, url) {
  const headers = {
    accept: "application/json,text/plain,*/*",
    ...(captured.headers || {})
  };
  delete headers["content-length"];
  delete headers["host"];
  delete headers["accept-encoding"];

  let res;
  if (captured.method === "POST") {
    if (captured.kind === "json") {
      res = await api.post(url, {
        headers: { ...headers, "content-type": "application/json;charset=UTF-8" },
        data: captured.json
      });
    } else if (captured.kind === "form") {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(captured.form)) params.set(k, String(v));
      res = await api.post(url, {
        headers: { ...headers, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        data: params.toString()
      });
    } else {
      res = await api.post(url, { headers });
    }
  } else {
    res = await api.get(url, { headers });
  }

  const txt = await res.text();
  if (!res.ok()) throw new Error(`HTTP ${res.status()} for ${url}\n${txt.slice(0, 800)}`);
  return JSON.parse(txt);
}

function sanitizeHeaders(h) {
  const out = { ...h };
  delete out["content-length"];
  delete out["accept-encoding"];
  return out;
}

function setOffsetAndLimit(captured, offset, limit) {
  if (captured.kind === "json" && captured.json && typeof captured.json === "object") {
    captured.json.offset = offset;
    captured.json.limit = limit;
    if ("count" in captured.json && typeof captured.json.count === "number") captured.json.count = limit;
    return;
  }

  if (captured.kind === "form" && captured.form && typeof captured.form === "object") {
    captured.form.offset = String(offset);
    captured.form.limit = String(limit);
    if ("count" in captured.form) captured.form.count = String(limit);
    return;
  }

  // Some tenants use GET with query params; if so, update the URL.
  if (captured.method === "GET" && captured.url) {
    try {
      const u = new URL(captured.url);
      u.searchParams.set("offset", String(offset));
      u.searchParams.set("limit", String(limit));
      if (u.searchParams.has("count")) u.searchParams.set("count", String(limit));
      captured.url = u.toString();
    } catch {
      // ignore
    }
  }
}
