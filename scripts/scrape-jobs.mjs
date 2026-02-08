import { writeFile, mkdir } from "node:fs/promises";

import { sites } from "./sites.mjs";
import { scrapeWorkday } from "./adapters/workday.mjs";
import { scrapeSapHtml } from "./adapters/sap-html.mjs";

import { toCsv } from "./lib/csv.mjs";
import { cleanText } from "./lib/normalize.mjs";
import { parseLocation } from "./lib/location.mjs";
import { createLimiter } from "./lib/limit.mjs";
import { detectLangEnDe } from "./lib/lang.mjs";

function isJobValid(job) {
  return Boolean(
    cleanText(job?.id) &&
      cleanText(job?.title) &&
      cleanText(job?.company?.id) &&
      cleanText(job?.company?.name) &&
      cleanText(job?.url)
  );
}

function uniqById(items) {
  const m = new Map();
  for (const x of items) {
    if (!x?.id) continue;
    if (!m.has(x.id)) m.set(x.id, x);
  }
  return Array.from(m.values());
}

function countByCompany(jobs) {
  const out = {};
  for (const j of jobs) {
    const id = j?.company?.id || "unknown";
    out[id] = (out[id] || 0) + 1;
  }
  return out;
}

function inferWorkplace(job) {
  const existing = cleanText(job?.workplace || "");
  if (existing) return { workplace: existing, confidence: "high" };

  const hay = [
    job?.title || "",
    job?.location || "",
    job?.description?.text || ""
  ]
    .join(" ")
    .toLowerCase();

  const hasRemote = /\b(remote|work from home|home office|telework)\b/.test(hay);
  const hasHybrid = /\b(hybrid)\b/.test(hay);
  const hasOnsite = /\b(on[- ]?site|onsite|in[- ]office)\b/.test(hay);

  if (hasRemote && !hasHybrid) return { workplace: "remote", confidence: "medium" };
  if (hasHybrid) return { workplace: "hybrid", confidence: "medium" };
  if (hasOnsite) return { workplace: "onsite", confidence: "medium" };

  return { workplace: "unknown", confidence: "low" };
}

function enrichJob(job) {
  const parsed = parseLocation(job.location);
  const wp = inferWorkplace(job);

  const desc = cleanText(job?.description?.text || "");
  const lang = detectLangEnDe(desc);
  const language = lang === "en" || lang === "de" ? lang : "unknown";

  return {
    ...job,
    language,
    locationParsed: {
      raw: parsed.raw,
      country: parsed.country,
      region: parsed.region,
      city: parsed.city
    },
    locationConfidence: parsed.confidence,
    workplace: wp.workplace,
    workplaceConfidence: wp.confidence
  };
}

function keepOnlyEnglishOrGerman(job) {
  return job.language === "en" || job.language === "de";
}

async function scrapeOneSite(site) {
  if (site.kind === "workday") {
    const wd = site.workday;
    return await scrapeWorkday({
      company: site.company,
      host: wd.host,
      tenant: wd.tenant,
      site: wd.site,
      pageSize: wd.pageSize ?? 200,
      maxTotal: wd.maxTotal ?? 5000
    });
  }

  if (site.kind === "sap_html" || site.kind === "sap") {
    return await scrapeSapHtml({
      company: site.company,
      pageSize: site.sap?.pageSize ?? 100,
      maxStart: site.sap?.maxStart ?? 5000
    });
  }

  throw new Error(`Unknown site.kind: ${site.kind}`);
}

async function main() {
  await mkdir("public", { recursive: true });

  const limiter = createLimiter(2);

  const all = [];
  const scrapedValidByCompany = {};

  for (const site of sites) {
    console.log(`Scraping: ${site.company.name} (${site.kind})`);

    try {
      const jobs = await limiter(async () => await scrapeOneSite(site));
      const valid = jobs.filter(isJobValid);

      scrapedValidByCompany[site.company.id] = valid.length;
      console.log(`  -> valid jobs: ${valid.length}`);

      // Optional quick sanity check: description length
      const sample = valid.find((j) => (j?.description?.text || "").length > 200);
      console.log(`  sample desc length: ${sample ? (sample.description.text || "").length : 0}`);

      all.push(...valid);
    } catch (e) {
      scrapedValidByCompany[site.company.id] = 0;
      console.error(`  !! failed: ${e?.message || e}`);
    }
  }

  let jobs = uniqById(all);

  const before = jobs.length;
  const beforeByCompany = countByCompany(jobs);

  jobs = jobs.map(enrichJob);
  jobs = jobs.filter(keepOnlyEnglishOrGerman);

  const after = jobs.length;
  const afterByCompany = countByCompany(jobs);

  jobs.sort((a, b) => {
    return (
      a.company.name.localeCompare(b.company.name) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
    );
  });

  const meta = {
    scrapedAt: new Date().toISOString(),
    enabledCompanies: sites.map((s) => ({
      id: s.company.id,
      name: s.company.name,
      kind: s.kind
    })),
    scrapedValidByCompany,
    totalBeforeLangFilter: before,
    totalAfterLangFilter: after,
    byCompanyBeforeLangFilter: beforeByCompany,
    byCompanyAfterLangFilter: afterByCompany,
    langPolicy: {
      keep: ["en", "de"],
      rule: "Keep jobs only if description language is confidently English or German."
    },
    notes: [
      "Workplace can be missing in sources; it is inferred from title/location/description when absent.",
      "Location parsing is heuristic; check locationConfidence."
    ]
  };

  await writeFile("public/jobs.json", JSON.stringify(jobs, null, 2));
  await writeFile("public/jobs.csv", toCsv(jobs));
  await writeFile("public/jobs-meta.json", JSON.stringify(meta, null, 2));

  console.log("By company after strict filter:", afterByCompany);
  console.log(`Done. Wrote ${jobs.length} jobs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
