import { fetch } from "undici";

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export async function fetchText(url, { timeoutMs = 30000, headers = {} } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
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

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

export async function fetchJsonMaybe(url, opts = {}) {
  try {
    return await fetchJson(url, opts);
  } catch {
    return null;
  }
}
