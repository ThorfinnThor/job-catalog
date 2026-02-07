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

function countByCompany(jobs) {
  const out = {};
  for (const j of jobs) {
    const id = j?.company?.id || "unknown";
    out[id] = (out[id] || 0) + 1;
  }
  return out;
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

  // ✅ HARD FAIL if SAP sources are empty (prevents silent bad deploys)
  const required = ["biontech", "boehringer"];
  const missing = required.filter((id) => (scrapedValidByCompany[id] || 0) === 0);
  if (missing.length) {
    throw new Error(
      `One or more required sources produced 0 jobs: ${missing.join(
        ", "
      )}. Check public/debug-<company>-list.html in the repo for the HTML GitHub Actions received.`
    );
  }

  let jobs = uniqById(all);

  // Keep EN/DE/unknown; drop only confident "other"
  jobs = jobs.filter((j) => {
    const desc = j?.description?.text || "";
    return classifyDescLang(desc) !== "other";
  });

  const byCompanyAfter = countByCompany(jobs);

  jobs = jobs.sort((a, b) => {
    return a.company.name.localeCompare(b.company.name) || a.title.localeCompare(b.title);
  });

  const meta = {
    scrapedAt: new Date().toISOString(),
    total: jobs.length,
    scrapedValidByCompany,
    byCompanyAfterFilter: byCompanyAfter
  };

  await writeFile("public/jobs.json", JSON.stringify(jobs, null, 2));
  await writeFile("public/jobs.csv", toCsv(jobs));
  await writeFile("public/jobs-meta.json", JSON.stringify(meta, null, 2));

  console.log("By company after filter:", byCompanyAfter);
  console.log(`Done. Wrote ${jobs.length} jobs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
