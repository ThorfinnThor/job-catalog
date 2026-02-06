# Job Scout MVP (Next.js + GitHub Actions + Vercel)

This repo scrapes a small set of company career pages on a schedule, writes:
- `public/jobs.json`
- `public/jobs.csv`
- `public/jobs-meta.json`

…and serves a simple, SEO-friendly job search UI in **Next.js**.

## Included companies (MVP)
- BioNTech — https://jobs.biontech.com/search/?createNewAlert=false&q=&optionsFacetsDD_location=&optionsFacetsDD_customfield1=&optionsFacetsDD_customfield2=
- GSK — https://jobs.gsk.com/en-gb/jobs?location=Germany&page=1
- Immatics (Workday) — https://immatics.wd3.myworkdayjobs.com/Immatics_External

## Local development

```bash
npm install
npm run scrape
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Set environment variable:
   - `NEXT_PUBLIC_SITE_URL` = your deployed URL (e.g. `https://your-app.vercel.app`)

Vercel will redeploy on every push.

## Scheduled scraping

A GitHub Actions workflow runs daily and commits updated `public/jobs.*` files back into the repo.

Workflow: `.github/workflows/scrape.yml`

## Notes & caveats

### GSK scraping
`jobs.gsk.com` may return `403 Forbidden` to non-browser clients. The MVP uses Playwright to simulate a real browser, but
some bot defenses can still block datacenter IPs. If that happens, you may need to:
- run the scrape from a different network,
- add proxy support,
- or use an official feed/API if available.

### Compliance
Always check and comply with:
- the site's Terms of Service,
- robots.txt,
- and applicable laws/policies.

## Where to add more companies
Edit `scripts/sites.mjs` and add a new adapter or use generic HTML/Playwright approaches.
