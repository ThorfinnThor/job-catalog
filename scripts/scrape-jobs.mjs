import { writeFile } from "node:fs/promises";
import { sites } from "./sites.mjs";
import { toCsv } from "./lib/csv.mjs";
import { cleanText } from "./lib/normalize.mjs";
import { createLimiter } from "./lib/limit.mjs";

import { scrapeSapHtml } from "./adapters/sap-html.mjs";
import { scrapeWorkday } from "./adapters/workday.mjs";
import { isEnglishOrGermanDescription } from "./lib/desc-lang.mjs";

function isJobValid(job) {
  return Boolean(cleanText(job.title) && job.url && job.company?.id);
}

function uniqById(items) {
  return Array.from(new Map(items.map((x) => [x.id, x])).values());
}

async function scrapeOneSite(site) {
  if (site.kind === "sap_html") {
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

async function main() {
  const all = [];
  const sourceCounts = {};
  const limit = createLimiter(2);

  for (const site of sites) {
    console.log(`Scraping: ${site.company.name} (${site.kind})`);
    try {
      const jobs = await limit(async () => await scrapeOneSite(site));
      const good = jobs.filter(isJobValid);

      console.log(`  -> ${good.length} jobs`);
      sourceCounts[site.company.id] = good.length;
      all.push(...good);
    } catch (e) {
      console.error(`  !! failed: ${e.message}`);
      sourceCounts[site.company.id] = 0;
    }
  }

  // Dedupe
  let jobs = uniqById(all);

  // ✅ Filter: keep only jobs whose descriptions are English or German
  const before = jobs.length;
  jobs = jobs.filter((j) => {
    const desc = j?.description?.text || "";
    return isEnglishOrGermanDescription(desc);
  });
  const after = jobs.length;

  // Sort for stable output
  jobs = jobs.sort((a, b) => {
    return a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title);
  });

  const meta = {
    scrapedAt: new Date().toISOString(),
    total: jobs.length,
    totalBeforeLangFilter: before,
    totalAfterLangFilter: after,
    langFilter: ["en", "de"],
    sources: sourceCounts
  };

  await writeFile("public/jobs.json", JSON.stringify(jobs, null, 2));
  await writeFile("public/jobs.csv", toCsv(jobs));
  await writeFile("public/jobs-meta.json", JSON.stringify(meta, null, 2));

  console.log(`Done. Wrote ${jobs.length} jobs (before lang filter: ${before}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
