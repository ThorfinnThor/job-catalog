import { writeFile } from "node:fs/promises";
import { sites } from "./sites.mjs";
import { toCsv } from "./lib/csv.mjs";
import { cleanText } from "./lib/normalize.mjs";
import { createLimiter } from "./lib/limit.mjs";

import { scrapeSapHtml } from "./adapters/sap-html.mjs";
import { scrapeWorkday } from "./adapters/workday.mjs";
import { classifyEnDeStrict } from "./lib/desc-lang.mjs";
import { parseLocation } from "./lib/location.mjs";

function isJobValid(job) {
  return Boolean(cleanText(job.title) && job.url && job.company?.id);
}

function uniqById(items) {
  return Array.from(new Map(items.map((x) => [x.id, x])).values());
}

function countByCompany(jobs) {
  const out = {};
  for (const j of jobs) {
    const id = j?.company?.id || "unknown";
    out[id] = (out[id] || 0) + 1;
  }
  return out;
}

async function scrapeOneSite(site) {
  if (site.kind === "sap_html" || site.kind === "sap") {
    return await scrapeSapHtml({
      company: site.company,
      pageSize: site.sap?.pageSize ?? 100,
      maxStart: site.sap?.maxStart ?? 5000
    });
  }
  if (site.kind === "workday") {
    const wd = site.workday;
    return await scrapeWorkday({
      company: site.company,
      host: wd.host,
      tenant: wd.tenant,
      site: wd.site
    });
  }
  throw new Error(`Unknown site.kind: ${site.kind}`);
}

function inferWorkplace(job) {
  // If adapter already set workplace, we trust it (high)
  const existing = cleanText(job.workplace || "");
  if (existing) return { workplace: existing, confidence: "high" };

  const hay = `${job.title || ""} ${job.location || ""} ${job.description?.text || ""}`.toLowerCase();

  const hasRemote = /\b(remote|work from home|home office|telework)\b/.test(hay);
  const hasHybrid = /\b(hybrid)\b/.test(hay);
  const hasOnsite = /\b(on[- ]?site|onsite|in[- ]office)\b/.test(hay);

  if (hasRemote && !hasHybrid) return { workplace: "remote", confidence: "medium" };
  if (hasHybrid) return { workplace: "hybrid", confidence: "medium" };
  if (hasOnsite) return { workplace: "onsite", confidence: "medium" };

  return { workplace: "unknown", confidence: "low" };
}

function detectLang(job) {
  const desc = job?.description?.text || "";
  const title = job?.title || "";

  const fromDesc = classifyEnDeStrict(desc);
  if (fromDesc !== "other") return fromDesc;

  return classifyEnDeStrict(title);
}

async function main() {
  const all = [];
  const scrapedValidByCompany = {};
  const limit = createLimiter(2);

  for (const site of sites) {
    console.log(`Scraping: ${site.company.name} (${site.kind})`);
    try {
      const jobs = await limit(async () => await scrapeOneSite(site));
      const good = jobs.filter(isJobValid);

      console.log(`  -> valid jobs: ${good.length}`);
      scrapedValidByCompany[site.company.id] = good.length;
      all.push(...good);
    } catch (e) {
      console.error(`  !! failed: ${e.message}`);
      scrapedValidByCompany[site.company.id] = 0;
    }
  }

  let jobs = uniqById(all);

  const before = jobs.length;
  const beforeByCompany = countByCompany(jobs);

  // Enrich + STRICT filter: keep ONLY English/German
  jobs = jobs
    .map((j) => {
      const language = detectLang(j); // en|de|other
      const parsed = parseLocation(j.location);

      const wp = inferWorkplace(j);

      return {
        ...j,
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
    })
    .filter((j) => j.language === "en" || j.language === "de");

  const after = jobs.length;
  const afterByCompany = countByCompany(jobs);

  jobs = jobs.sort((a, b) => {
    return a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title);
  });

  const meta = {
    scrapedAt: new Date().toISOString(),
    total: jobs.length,
    totalBeforeStrictLangFilter: before,
    totalAfterStrictLangFilter: after,
    strictLangKeep: ["en", "de"],
    scrapedValidByCompany,
    byCompanyBeforeStrictLangFilter: beforeByCompany,
    byCompanyAfterStrictLangFilter: afterByCompany,
    enabledCompanies: sites.map((s) => ({ id: s.company.id, name: s.company.name, kind: s.kind }))
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
