import Link from "next/link";
import SearchClient from "@/components/SearchClient";
import { getJobs, getJobsMeta } from "@/lib/jobs";

export default async function HomePage() {
  const jobs = await getJobs();
  const meta = await getJobsMeta();

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <h1 className="h1">Job Scout MVP</h1>
          <p className="sub">
            Aggregated jobs from BioNTech, GSK, and Immatics — refreshed via GitHub Actions and served on Vercel.
          </p>
        </div>

        <div className="badge">
          <span>Total: {jobs.length}</span>
          <span>·</span>
          <span>
            Updated: {meta?.scrapedAt ? new Date(meta.scrapedAt).toLocaleString() : "unknown"}
          </span>
        </div>
      </div>

      <SearchClient jobs={jobs} />

      <div className="footer">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 }}>
          <Link href="/jobs.json">jobs.json</Link>
          <Link href="/jobs.csv">jobs.csv</Link>
        </div>
        <div style={{ marginTop: 10 }}>
          This is an MVP. For production use, ensure you comply with each site’s terms of service and robots.txt.
        </div>
      </div>
    </main>
  );
}
