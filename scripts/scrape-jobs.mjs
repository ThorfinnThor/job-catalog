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
  const ctx = { company: site.company };

  if (site.kind === "biontech_html") {
    return await scrapeBiontech(ctx);
  }

  if (site.kind === "workday") {
    const wd = site.workday;
    return await scrapeWorkday({ company: site.company, host: wd.host, tenant: wd.tenant, site: wd.site });
  }

  if (site.kind === "gsk_playwright") {
    return await scrapeGskPlaywright({ company: site.company, startUrl: site.company.careersUrl });
  }

  throw new Error(`Unknown site.kind: ${site.kind}`);
}

async function main() {
  const all = [];
  const sourceCounts = {};

  const limit = createLimiter(2); // be polite; Playwright is heavy

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
    return (
      a.company.name.localeCompare(b.company.name) ||
      a.title.localeCompare(b.title)
    );
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
