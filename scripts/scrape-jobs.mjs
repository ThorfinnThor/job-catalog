import { writeFile } from "node:fs/promises";
import { sites } from "./sites.mjs";
import { toCsv } from "./lib/csv.mjs";
import { cleanText } from "./lib/normalize.mjs";
import { createLimiter } from "./lib/limit.mjs";

import { scrapeSapHtml } from "./adapters/sap-html.mjs";
import { scrapeWorkday } from "./adapters/workday.mjs";
import { classifyDescLang } from "./lib/desc-lang.mjs";

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
  // ✅ Backward-compatible aliases for SAP/SuccessFactors boards
  if (site.kind === "sap_html" || site.kind === "biontech_html" || site.kind === "sap") {
    return await scrapeSapHtml({
      company: site.company,
      pageSize: site.sap?.pageSize ?? site.pageSize ?? 100,
      maxStart: site.sap?.maxStart ?? site.maxStart ?? 5000
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

  // Dedupe
  let jobs = uniqById(all);

  const before = jobs.length;
  const beforeByCompany = countByCompany(jobs);

  // ✅ Language filter rule:
  // Drop ONLY if confidently "other". Keep en/de/unknown.
  jobs = jobs.filter((j) => {
    const desc = j?.description?.text || "";
    const lang = classifyDescLang(desc);
    return lang !== "other";
  });

  const after = jobs.length;
  const afterByCompany = countByCompany(jobs);

  jobs = jobs.sort((a, b) => {
    return a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title);
  });

  const meta = {
    scrapedAt: new Date().toISOString(),
    total: jobs.length,
    totalBeforeLangFilter: before,
    totalAfterLangFilter: after,
    langFilterKeep: ["en", "de", "unknown"],
    langFilterDrop: ["other"],
    scrapedValidByCompany,
    byCompanyBeforeLangFilter: beforeByCompany,
    byCompanyAfterLangFilter: afterByCompany
  };

  await writeFile("public/jobs.json", JSON.stringify(jobs, null, 2));
  await writeFile("public/jobs.csv", toCsv(jobs));
  await writeFile("public/jobs-meta.json", JSON.stringify(meta, null, 2));

  console.log(`Done. Wrote ${jobs.length} jobs (before lang filter: ${before}).`);
  console.log("By company after filter:", afterByCompany);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
