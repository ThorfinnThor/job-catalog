import { cleanText } from "./normalize.mjs";

const KNOWN_COUNTRIES = new Set([
  "germany", "deutschland",
  "united kingdom", "uk", "england", "scotland", "wales", "northern ireland",
  "switzerland", "schweiz",
  "france", "italy", "spain", "netherlands", "belgium", "austria", "ireland",
  "denmark", "sweden", "norway", "finland", "poland", "czech republic",
  "hungary", "portugal", "greece", "romania", "bulgaria", "croatia",
  "slovakia", "slovenia", "lithuania", "latvia", "estonia", "luxembourg",
  "china", "japan", "united states", "usa", "canada", "india", "singapore",
  "australia", "brazil", "mexico"
]);

export function parseLocation(rawLocation) {
  const raw = cleanText(rawLocation || "");
  if (!raw) {
    return {
      raw: null,
      country: null,
      region: null,
      city: null,
      confidence: "low"
    };
  }

  // Workday common: "China - Shanghai - Shanghai"
  if (raw.includes(" - ")) {
    const parts = raw.split(" - ").map((p) => cleanText(p)).filter(Boolean);
    if (parts.length >= 2) {
      const country = parts[0];
      const city = parts[parts.length - 1];
      const region = parts.length > 2 ? parts.slice(1, -1).join(" - ") : null;

      return {
        raw,
        country,
        region,
        city,
        confidence: "high"
      };
    }
  }

  // Common: "Mainz, Germany" OR "Ingelheim, Germany"
  if (raw.includes(",")) {
    const parts = raw.split(",").map((p) => cleanText(p)).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const first = parts[0];

      return {
        raw,
        country: last,
        region: parts.length > 2 ? parts.slice(1, -1).join(", ") : null,
        city: first,
        confidence: "high"
      };
    }
  }

  // Try "Country: City" or "City (Country)" styles
  const paren = raw.match(/^(.+?)\s*\((.+?)\)\s*$/);
  if (paren) {
    const city = cleanText(paren[1]);
    const country = cleanText(paren[2]);
    return { raw, country, region: null, city, confidence: "medium" };
  }

  // Heuristic: if last token(s) match known country names, treat that as country
  // e.g. "Remote Work (Germany)" already caught by paren
  const lower = raw.toLowerCase();
  for (const c of KNOWN_COUNTRIES) {
    if (lower.endsWith(c)) {
      // Split at last comma/space is unreliable; just store raw as city-ish
      return { raw, country: raw.slice(raw.length - c.length), region: null, city: raw.slice(0, raw.length - c.length).trim(), confidence: "medium" };
    }
  }

  // Otherwise unknown structure
  return {
    raw,
    country: null,
    region: null,
    city: raw,
    confidence: "low"
  };
}
