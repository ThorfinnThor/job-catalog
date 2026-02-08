import { getJobById } from "@/lib/jobs";
import { notFound } from "next/navigation";

type Props = { params: { id: string } };

export function generateMetadata({ params }: Props) {
  const job = getJobById(decodeURIComponent(params.id));
  if (!job) return { title: "Job not found" };
  return {
    title: `${job.title} – ${job.company.name}`,
    description: (job.description?.text || "").slice(0, 160) || `${job.title} at ${job.company.name}`,
  };
}

export default function JobPage({ params }: Props) {
  const id = decodeURIComponent(params.id);
  const job = getJobById(id);
  if (!job) return notFound();

  const description = job.description?.text || "";

  const jobPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: description,
    hiringOrganization: {
      "@type": "Organization",
      name: job.company.name,
    },
    jobLocation: job.locationParsed?.country
      ? {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressCountry: job.locationParsed.country,
            addressRegion: job.locationParsed.region || undefined,
            addressLocality: job.locationParsed.city || undefined,
          },
        }
      : undefined,
    datePosted: job.postedAt || job.scrapedAt || undefined,
    employmentType: job.employmentType || undefined,
    url: job.url,
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingJsonLd) }}
      />

      <a href="/" className="text-sm text-white/60 hover:text-white/80">
        ← Back
      </a>

      <h1 className="mt-3 text-3xl font-bold leading-tight">{job.title}</h1>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/70">
        <span className="rounded-full border border-white/10 px-2 py-1">{job.company.name}</span>

        {job.locationParsed?.country ? (
          <span className="rounded-full border border-white/10 px-2 py-1">
            {job.locationParsed.country}
            {job.locationParsed.city ? ` · ${job.locationParsed.city}` : ""}
            {job.locationConfidence ? ` (${job.locationConfidence})` : ""}
          </span>
        ) : job.location ? (
          <span className="rounded-full border border-white/10 px-2 py-1">{job.location}</span>
        ) : null}

        <span className="rounded-full border border-white/10 px-2 py-1">
          {job.workplace} {job.workplaceConfidence ? `(${job.workplaceConfidence})` : ""}
        </span>

        <span className="rounded-full border border-white/10 px-2 py-1">{job.language.toUpperCase()}</span>

        {job.department ? (
          <span className="rounded-full border border-white/10 px-2 py-1">{job.department}</span>
        ) : null}
      </div>

      <div className="mt-6 flex gap-3">
        <a
          className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 hover:bg-white/15 transition"
          href={job.url}
          target="_blank"
          rel="noreferrer"
        >
          Open original posting
        </a>
        <a
          className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 hover:bg-white/15 transition"
          href={job.applyUrl || job.url}
          target="_blank"
          rel="noreferrer"
        >
          Apply
        </a>
      </div>

      <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-semibold">Description</h2>
        {description ? (
          <p className="mt-4 whitespace-pre-wrap leading-relaxed text-white/80">{description}</p>
        ) : (
          <p className="mt-4 text-white/60">No description captured.</p>
        )}
      </div>

      <div className="mt-6 text-sm text-white/50">
        Scraped: {job.scrapedAt ? new Date(job.scrapedAt).toLocaleString() : "unknown"}
      </div>
    </main>
  );
}
