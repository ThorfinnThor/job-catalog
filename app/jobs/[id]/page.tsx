import Link from "next/link";
import type { Metadata } from "next";
import { getJobById, excerpt } from "@/lib/jobs";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const job = await getJobById(decodeURIComponent(params.id));
  if (!job) return { title: "Job not found" };

  const desc = excerpt(job.description?.text, 180) || `Open role at ${job.company.name}.`;
  return {
    title: `${job.title}`,
    description: desc,
    alternates: { canonical: `/jobs/${encodeURIComponent(job.id)}` },
    openGraph: {
      title: job.title,
      description: desc,
      type: "article"
    }
  };
}

function jsonLd(job: any) {
  // Minimal schema.org JobPosting
  const loc = job.location ? { address: job.location } : undefined;
  const org = { name: job.company?.name };
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    hiringOrganization: org,
    jobLocation: loc ? { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.location } } : undefined,
    employmentType: job.employmentType ?? undefined,
    description: job.description?.html ?? job.description?.text ?? undefined,
    url: job.url,
    datePosted: job.postedAt ?? undefined
  };
}

export default async function JobPage({ params }: { params: { id: string } }) {
  const id = decodeURIComponent(params.id);
  const job = await getJobById(id);

  if (!job) {
    return (
      <main className="container">
        <div className="prose">
          <h1>Job not found</h1>
          <p>
            The job ID <code>{id}</code> is not in the current dataset.
          </p>
          <p>
            <Link href="/">Back to search</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="badge" style={{ marginBottom: 14 }}>
        <Link href="/">← Back</Link>
        <span>·</span>
        <span>{job.company.name}</span>
        <span>·</span>
        <span>{job.location ?? "Location not listed"}</span>
      </div>

      <div className="jobLayout">
        <article className="prose">
          <h1 style={{ marginTop: 0 }}>{job.title}</h1>

          <p className="small">
            Source: <strong>{job.source.kind}</strong>
            {" · "}
            Scraped: <strong>{new Date(job.scrapedAt).toLocaleString()}</strong>
          </p>

          <hr className="hr" />

          {job.description?.text ? (
            <div>
              <h2>Description</h2>
              <p style={{ whiteSpace: "pre-wrap" }}>{job.description.text}</p>
            </div>
          ) : (
            <p>No description found.</p>
          )}

          <script
            type="application/ld+json"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(job)) }}
          />
        </article>

        <aside className="side">
          <div className="metaRow" style={{ marginBottom: 12 }}>
            {job.workplace ? <span className="pill">{job.workplace}</span> : null}
            {job.employmentType ? <span className="pill">{job.employmentType}</span> : null}
            {job.department ? <span className="pill">{job.department}</span> : null}
            {job.team ? <span className="pill">{job.team}</span> : null}
          </div>

          <a className="button" href={job.applyUrl ?? job.url} target="_blank" rel="noreferrer">
            Apply / View original posting →
          </a>

          <div className="small" style={{ marginTop: 12 }}>
            <div>
              <strong>Original URL:</strong>
            </div>
            <div style={{ wordBreak: "break-word" }}>
              <a href={job.url} target="_blank" rel="noreferrer">
                {job.url}
              </a>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
