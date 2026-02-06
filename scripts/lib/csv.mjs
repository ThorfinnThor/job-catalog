function escapeCsv(v) {
  const s = String(v ?? "");
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(jobs) {
  const headers = [
    "id",
    "companyId",
    "companyName",
    "title",
    "location",
    "workplace",
    "employmentType",
    "department",
    "team",
    "url",
    "applyUrl",
    "postedAt",
    "scrapedAt"
  ];

  const lines = [
    headers.join(","),
    ...jobs.map((j) => {
      const row = {
        id: j.id,
        companyId: j.company.id,
        companyName: j.company.name,
        title: j.title,
        location: j.location,
        workplace: j.workplace,
        employmentType: j.employmentType,
        department: j.department,
        team: j.team,
        url: j.url,
        applyUrl: j.applyUrl,
        postedAt: j.postedAt,
        scrapedAt: j.scrapedAt
      };
      return headers.map((h) => escapeCsv(row[h])).join(",");
    })
  ];

  return lines.join("\n") + "\n";
}
