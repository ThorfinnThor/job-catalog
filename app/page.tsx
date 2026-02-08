import SearchClient from "@/components/SearchClient";
import { getAllJobs, getFacets } from "@/lib/jobs";
import meta from "@/public/jobs-meta.json";

export const metadata = {
  title: "Job Scout MVP",
  description:
    "Aggregated jobs from multiple company career pages — refreshed via GitHub Actions and served on Vercel.",
};

export default function Page() {
  const jobs = getAllJobs();
  const facets = getFacets(jobs);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-start justify-between gap-6 flex-col md:flex-row">
        <div>
          <h1 className="text-3xl font-bold">Job Scout MVP</h1>
          <p className="mt-2 text-white/70">
            Aggregated jobs — refreshed via GitHub Actions and served on Vercel.
          </p>
        </div>
        <div className="text-sm text-white/60 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          Total: <b className="text-white/80">{jobs.length}</b>
        </div>
      </div>

      <div className="mt-8">
        <SearchClient jobs={jobs} facets={facets} updatedAt={(meta as any)?.scrapedAt || null} />
      </div>
    </main>
  );
}
