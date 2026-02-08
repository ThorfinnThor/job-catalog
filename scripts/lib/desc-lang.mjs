import { cleanText } from "./normalize.mjs";

export function classifyEnDeStrict(text) {
  const raw = cleanText(text || "");
  if (!raw) return "other";

  if (containsNonLatinScript(raw)) return "other";
  if (raw.length < 160) return "other";

  const t = raw.toLowerCase();
  const umlautBonus = /[äöüß]/.test(t) ? 3 : 0;

  const deWords = [
    "und","der","die","das","nicht","mit","für","auf","als","wir","sie",
    "werden","können","aufgaben","anforderungen","voraussetzungen","bewerbung",
    "stelle","position","verantwortung","erfahrung","kenntnisse","ihnen"
  ];

  const enWords = [
    "the","and","with","you","we","will","role","position",
    "responsibilities","requirements","qualification","qualifications",
    "experience","apply","about","skills"
  ];

  const deScore = umlautBonus + countWordHits(t, deWords);
  const enScore = countWordHits(t, enWords);

  const isLong = raw.length >= 900;

  if (!isLong) {
    if (deScore >= 7 && deScore >= enScore + 1) return "de";
    if (enScore >= 7 && enScore >= deScore + 1) return "en";
    return "other";
  }

  if (deScore >= 5 && deScore >= enScore) return "de";
  if (enScore >= 5 && enScore >= deScore) return "en";

  return "other";
}

function containsNonLatinScript(s) {
  if (/\p{Script=Han}/u.test(s)) return true;
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(s)) return true;
  if (/\p{Script=Hangul}/u.test(s)) return true;
  if (/\p{Script=Cyrillic}/u.test(s)) return true;
  if (/\p{Script=Arabic}/u.test(s)) return true;
  if (/\p{Script=Hebrew}/u.test(s)) return true;
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
