import { fetch } from "undici";

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export async function fetchText(url, { timeoutMs = 30000, headers = {}, method = "GET", body } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      body,
      headers: {
        "user-agent": DEFAULT_UA,
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.8,de-DE;q=0.7,de;q=0.6",
        ...headers
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchTextWithCookies(url, cookieJar = "", { timeoutMs = 45000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": DEFAULT_UA,
        accept: "text/html,*/*",
        "accept-language": "en-US,en;q=0.8,de-DE;q=0.7,de;q=0.6",
        ...(cookieJar ? { cookie: cookieJar } : {})
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

    const text = await res.text();
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    return { text, cookies: setCookies };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, { ...opts, headers: { ...(opts.headers || {}), accept: "application/json,*/*" } });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}
