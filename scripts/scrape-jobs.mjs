import { writeFile } from "node:fs/promises";
import { sites } from "./sites.mjs";
import { toCsv } from "./lib/csv.mjs";
import { cleanText } from "./lib/normalize.mjs";
import { createLimiter } from "./lib/limit.mjs";

import { scrapeSapHtml } from "./adapters/sap-html.mjs";
import { scrapeWorkday } from "./adapters/workday.mjs";
import { classifyEnDeStrict } from "./lib/desc-lang.mjs";

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

function countLang(jobs) {
  const out = { en: 0, de: 0, other: 0 };
  for (const j of jobs) {
    out[j._lang || "other"] += 1;
  }
  return out;
}

async function scrapeOneSite(site) {
  if (site.kind === "sap_html" || site.kind === "biontech_html" || site.kind === "sap") {
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

function detectJobLang(job) {
  const desc = job?.description?.text || "";
  const title = job?.title || "";

  // Prefer description if it’s substantive; else fall back to title
  const fromDesc = classifyEnDeStrict(desc);
  if (fromDesc !== "other") return fromDesc;

  const fromTitle = classifyEnDeStrict(title);
  return fromTitle;
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

  // ✅ STRICT filter: keep ONLY English or German
  jobs = jobs
    .map((j) => {
      const lang = detectJobLang(j);
      return { ...j, _lang: lang }; // internal; we’ll drop this field before writing
    })
    .filter((j) => j._lang === "en" || j._lang === "de")
    .map(({ _lang, ...rest }) => rest);

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

  console.log(`Done. Wrote ${jobs.length} jobs (before strict filter: ${before}).`);
  console.log("By company after strict filter:", afterByCompany);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
