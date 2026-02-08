import { getAllJobs } from "@/lib/jobs";

export default function sitemap() {
  const jobs = getAllJobs();
  const baseUrl = "https://job-catalog.vercel.app"; // change if you use a custom domain

  const urls = [
    { url: `${baseUrl}/`, lastModified: new Date() },
    ...jobs.map((j) => ({
      url: `${baseUrl}/jobs/${encodeURIComponent(j.id)}`,
      lastModified: j.scrapedAt ? new Date(j.scrapedAt) : new Date(),
    })),
  ];

  return urls;
}
