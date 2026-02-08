import { cleanText } from "./normalize.mjs";

/**
 * STRICT language classification:
 * - "en" or "de" only if we're confident it is English/German
 * - otherwise "other"
 *
 * Uses:
 * 1) script detection (CJK, Cyrillic, Arabic, etc.) => other
 * 2) EN/DE stopword scoring with word boundaries
 */
export function classifyEnDeStrict(text) {
  const raw = cleanText(text || "");
  if (!raw) return "other";

  // If text contains strong non-Latin scripts, it is not EN/DE
  if (containsNonLatinScript(raw)) return "other";

  // Too short => not enough evidence => treat as other (STRICT)
  if (raw.length < 160) return "other";

  const t = raw.toLowerCase();

  // German umlaut bonus
  const umlautBonus = /[äöüß]/.test(t) ? 3 : 0;

  const deWords = [
    "und", "der", "die", "das", "nicht", "mit", "für", "auf", "als", "wir", "sie",
    "werden", "können", "aufgaben", "anforderungen", "voraussetzungen", "bewerbung",
    "stelle", "position", "verantwortung", "erfahrung", "kenntnisse", "team", "ihnen"
  ];

  const enWords = [
    "the", "and", "with", "you", "we", "will", "role", "position",
    "responsibilities", "requirements", "qualification", "qualifications",
    "experience", "apply", "about", "skills", "team"
  ];

  const deScore = umlautBonus + countWordHits(t, deWords);
  const enScore = countWordHits(t, enWords);

  // Strict thresholds
  // - Short/medium texts require stronger evidence
  // - Very long texts can pass with slightly lower evidence
  const isLong = raw.length >= 900;

  if (!isLong) {
    if (deScore >= 7 && deScore >= enScore + 1) return "de";
    if (enScore >= 7 && enScore >= deScore + 1) return "en";
    return "other";
  }

  // Long descriptions: allow slightly lower threshold
  if (deScore >= 5 && deScore >= enScore) return "de";
  if (enScore >= 5 && enScore >= deScore) return "en";

  return "other";
}

/**
 * Detects scripts that strongly indicate the text is not EN/DE.
 * We allow Latin (incl. accents), digits, punctuation.
 */
function containsNonLatinScript(s) {
  // CJK ideographs (Chinese)
  if (/\p{Script=Han}/u.test(s)) return true;
  // Japanese
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(s)) return true;
  // Korean
  if (/\p{Script=Hangul}/u.test(s)) return true;
  // Cyrillic
  if (/\p{Script=Cyrillic}/u.test(s)) return true;
  // Arabic
  if (/\p{Script=Arabic}/u.test(s)) return true;
  // Hebrew
  if (/\p{Script=Hebrew}/u.test(s)) return true;
  // Thai
  if (/\p{Script=Thai}/u.test(s)) return true;

  return false;
}

function countWordHits(text, words) {
  let score = 0;
  for (const w of words) {
    const re = new RegExp(`\\b${escapeRe(w)}\\b`, "i");
    if (re.test(text)) score += 1;
  }
  return score;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
