export function cleanText(s) {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function absoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function stripHtml(html) {
  return cleanText(String(html ?? "").replace(/<[^>]*>/g, " "));
}

export function stableId(prefix, uniqueString) {
  return `${prefix}:${Buffer.from(uniqueString).toString("base64url")}`;
}

export function normalizeEmploymentType(v) {
  const s = cleanText(v).toLowerCase();
  if (!s) return null;
  if (s.includes("full")) return "full_time";
  if (s.includes("part")) return "part_time";
  if (s.includes("contract")) return "contract";
  if (s.includes("intern")) return "internship";
  if (s.includes("temp")) return "temporary";
  return null;
}

export function normalizeWorkplace(v) {
  const s = cleanText(v).toLowerCase();
  if (!s) return null;
  if (s.includes("remote")) return "remote";
  if (s.includes("hybrid")) return "hybrid";
  if (s.includes("on-site") || s.includes("onsite") || s.includes("office") || s.includes("site")) return "onsite";
  return null;
}

export function safeIsoDate(v) {
  try {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}
