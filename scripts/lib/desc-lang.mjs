import { cleanText } from "./normalize.mjs";

/**
 * Classify description language into:
 * - "en" (English)
 * - "de" (German)
 * - "other" (confidently NOT English/German)
 * - "unknown" (can't tell reliably)
 *
 * This is designed for filtering:
 *   KEEP: en, de, unknown
 *   DROP: other
 */
export function classifyDescLang(text) {
  const raw = cleanText(text || "");
  if (!raw) return "unknown";

  // Very short text isn't reliable for language detection
  if (raw.length < 180) return "unknown";

  const t = raw.toLowerCase();

  // Strong German signal (umlauts)
  const hasUmlaut = /[äöüß]/.test(t);

  // High-signal stopwords (word-boundary matching so punctuation doesn't break it)
  const deWords = [
    "und", "der", "die", "das", "nicht", "mit", "für", "auf", "als", "wir", "sie",
    "werden", "können", "aufgaben", "anforderungen", "voraussetzungen", "bewerbung",
    "stelle", "position", "verantwortung", "erfahrung"
  ];

  const enWords = [
    "the", "and", "with", "you", "we", "will", "role", "position",
    "responsibilities", "requirements", "qualification", "qualifications",
    "experience", "apply", "about"
  ];

  // A few "other language" signals to confidently classify as OTHER
  // (We keep this conservative — only strong, common words.)
  const otherSignals = [
    // French
    " le ", " la ", " les ", " des ", " pour ", " vous ", " nous ", " poste ", " responsabilités",
    // Spanish
    " el ", " la ", " los ", " las ", " para ", " usted ", " nosotros ", " responsabilidades", " requisitos",
    // Italian
    " il ", " lo ", " gli ", " per ", " voi ", " noi ", " responsabilità", " requisiti"
  ];

  const deScore = (hasUmlaut ? 3 : 0) + countWordHits(t, deWords);
  const enScore = countWordHits(t, enWords);

  // Decide EN/DE if we have strong evidence
  if (deScore >= 7 && deScore >= enScore) return "de";
  if (enScore >= 7 && enScore >= deScore) return "en";

  // If long description, allow medium confidence for EN/DE
  if (raw.length >= 900) {
    if (deScore >= 5 && deScore >= enScore) return "de";
    if (enScore >= 5 && enScore >= deScore) return "en";
  }

  // Now decide OTHER only if we have evidence AGAINST EN/DE:
  const otherScore = countSubstringHits(t, otherSignals);

  // "Other" only if:
  // - lots of other-language signals
  // - AND EN/DE scores are low
  if (otherScore >= 6 && deScore <= 3 && enScore <= 3) return "other";

  // Otherwise we don't know (keep it)
  return "unknown";
}

function countWordHits(text, words) {
  let score = 0;
  for (const w of words) {
    const re = new RegExp(`\\b${escapeRe(w)}\\b`, "i");
    if (re.test(text)) score += 1;
  }
  return score;
}

function countSubstringHits(text, needles) {
  let score = 0;
  for (const n of needles) {
    if (text.includes(n)) score += 1;
  }
  return score;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
