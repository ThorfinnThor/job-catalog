import { fetch as undiciFetch } from "undici";

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,de-DE;q=0.8,de;q=0.7",
};

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, opts = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 25000,
    retries = 6,
    retryBaseMs = 1000,
  } = opts;

  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await undiciFetch(url, {
        method,
        headers: { ...DEFAULT_HEADERS, ...headers },
        body,
        redirect: "follow",
        signal: ac.signal,
      });

      clearTimeout(timer);

      // Retry on known transient statuses
      if (RETRY_STATUS.has(res.status) && attempt < retries) {
        // drain body
        try { await res.arrayBuffer(); } catch {}
        const backoff = retryBaseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        await sleep(backoff);
        continue;
      }

      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;

      // Retry network/timeouts
      if (attempt < retries) {
        const backoff = retryBaseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  throw lastErr || new Error(`Fetch failed: ${url}`);
}

export async function fetchText(url, opts = {}) {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`HTTP ${res.status} for ${url}${body ? `\n${body.slice(0, 200)}` : ""}`);
  }
  return await res.text();
}

export async function fetchJson(url, opts = {}) {
  const res = await fetchWithRetry(url, {
    ...opts,
    headers: { accept: "application/json,text/plain,*/*", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(`HTTP ${res.status} for ${url}${body ? `\n${body.slice(0, 200)}` : ""}`);
  }
  return await res.json();
}

/**
 * Fetch text and capture Set-Cookie headers (for sticky sessions on some SAP boards).
 * cookieJar is a string like: "a=b; c=d"
 */
export async function fetchTextWithCookies(url, cookieJar = "", opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookieJar) headers.cookie = cookieJar;

  const res = await fetchWithRetry(url, { ...opts, headers });

  // undici exposes getSetCookie(); fall back to single header
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return { text, cookies, status: res.status };
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
