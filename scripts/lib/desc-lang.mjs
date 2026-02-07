import { cleanText } from "./normalize.mjs";

/**
 * Very light heuristic language detector for job descriptions.
 * Returns true only if the description is likely English or German.
 *
 * Goal: simple + robust in CI without heavy dependencies.
 */
export function isEnglishOrGermanDescription(text) {
  const t = cleanText(text || "");
  if (!t) return false;

  // Too short often means garbage or incomplete
  if (t.length < 250) return false;

  const lower = t.toLowerCase();

  // Strong German signals
  const hasUmlaut = /[äöüß]/i.test(lower);

  const deWords = [
    " und ", " der ", " die ", " das ", " nicht ", " mit ", " für ", " auf ", " als ",
    " wir ", " sie ", " ihr ", " ihre ", " einen ", " eine ", " ein ", " bei ", " wird ",
    " sind ", " wird ", " werden ", " können ", " möglich ", " verantwortung", " aufgaben",
    " anforderungen", " voraussetzungen", " bewerbung"
  ];

  const enWords = [
    " the ", " and ", " with ", " you ", " we ", " to ", " of ", " for ", " in ", " on ",
    " are ", " will ", " role ", " responsibilities", " requirements", " qualifications",
    " apply ", " position "
  ];

  const deScore = (hasUmlaut ? 3 : 0) + countHits(lower, deWords);
  const enScore = countHits(lower, enWords);

  // Minimum confidence:
  // - allow either language, but prevent false positives on boilerplate
  const threshold = 4;

  if (deScore >= threshold && deScore >= enScore) return true;
  if (enScore >= threshold && enScore > deScore) return true;

  return false;
}

function countHits(text, needles) {
  let score = 0;
  for (const n of needles) {
    if (text.includes(n)) score += 1;
  }
  return score;
}
