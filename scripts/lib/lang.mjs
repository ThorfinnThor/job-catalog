export function detectLangEnDe(text) {
  const t = (text || "").toLowerCase();
  if (t.length < 200) return "unknown"; // too short to be confident

  const deStops = [" und ", " der ", " die ", " das ", " nicht ", " mit ", " für ", " auf ", " wir ", " als ", " ein ", " eine "];
  const enStops = [" the ", " and ", " you ", " your ", " with ", " for ", " we ", " our ", " will ", " role ", " experience "];

  let de = 0, en = 0;

  for (const w of deStops) if (t.includes(w)) de += 1;
  for (const w of enStops) if (t.includes(w)) en += 1;

  if (/[äöüß]/.test(t)) de += 2;

  if (de >= en + 2) return "de";
  if (en >= de + 2) return "en";
  return "unknown";
}
