import { writeFile } from "node:fs/promises";
import { sites } from "./sites.mjs";
import { toCsv } from "./lib/csv.mjs";
import { cleanText } from "./lib/normalize.mjs";
import { createLimiter } from "./lib/limit.mjs";

import { scrapeBiontech } from "./adapters/biontech.mjs";
import { scrapeWorkday } from "./adapters/workday.mjs";
import { scrapeGskPlaywright } from "./adapters/gsk-playwright.mjs";

function isJobValid(job) {
  return Boolean(cleanText(job.title) && job.url && job.company?.id);
}

function uniqById(items) {
  return Array.from(new Map(items.map((x) => [x.id, x])).values());
}

async function scrapeOneSite(site) {
  if (site.kind === "biontech_html") {
    return await scrapeBiontech({ company: site.company });
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

  if (site.kind === "gsk_playwright") {
    // 1) Try jobs.gsk.com via Playwright
    const pw = await scrapeGskPlaywright({ company: site.company, startUrl: site.company.careersUrl });
    const pwGood = pw.filter(isJobValid);

    if (pwGood.length > 0) return pwGood;

    console.warn("[gsk] Playwright returned 0 jobs; falling back to Workday CXS feed…");

    // 2) Fallback to GSK Workday (much more bot-friendly)
    // NOTE: this is a pragmatic workaround when jobs.gsk.com blocks CI runners.
    const wdJobs = await scrapeWorkday({
      company: site.company,
      host: "gsk.wd5.myworkdayjobs.com",
      tenant: "gsk",
      site: "GSKCareers"
    });

    // filter to Germany, since your original GSK URL was Germany-filtered
    return wdJobs.filter((j) => (j.location || "").toLowerCase().includes("germany"));
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

  const jobs = uniqById(all).sort((a, b) => {
    return a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title);
  });

  const meta = {
    scrapedAt: new Date().toISOString(),
    total: jobs.length,
    sources: sourceCounts
  };

  await writeFile("public/jobs.json", JSON.stringify(jobs, null, 2));
  await writeFile("public/jobs.csv", toCsv(jobs));
  await writeFile("public/jobs-meta.json", JSON.stringify(meta, null, 2));

  console.log(`Done. Wrote ${jobs.length} total jobs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
