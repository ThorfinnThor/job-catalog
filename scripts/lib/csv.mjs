function q(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(jobs) {
  const cols = [
    "id",
    "companyId",
    "companyName",
    "title",
    "language",
    "locationRaw",
    "country",
    "region",
    "city",
    "locationConfidence",
    "workplace",
    "workplaceConfidence",
    "employmentType",
    "department",
    "url",
    "applyUrl",
    "postedAt",
    "scrapedAt",
    "description"
  ];

  const lines = [cols.join(",")];

  for (const j of jobs) {
    const row = [
      j.id,
      j.company?.id,
      j.company?.name,
      j.title,
      j.language,
      j.location,
      j.locationParsed?.country,
      j.locationParsed?.region,
      j.locationParsed?.city,
      j.locationConfidence,
      j.workplace,
      j.workplaceConfidence,
      j.employmentType,
      j.department,
      j.url,
      j.applyUrl,
      j.postedAt,
      j.scrapedAt,
      (j.description?.text || "").slice(0, 2000) // keep CSV manageable
    ].map(q);

    lines.push(row.join(","));
  }

  return lines.join("\n");
}
