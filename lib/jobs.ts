import jobs from "@/public/jobs.json";

export type Job = {
  id: string;
  company: { id: string; name: string };
  title: string;
  language: "en" | "de";
  location: string | null;
  locationParsed?: {
    raw: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
  };
  locationConfidence?: "high" | "medium" | "low";
  workplace: "remote" | "hybrid" | "onsite" | "unknown" | string;
  workplaceConfidence?: "high" | "medium" | "low";
  employmentType?: string | null;
  department?: string | null;
  url: string;
  applyUrl?: string;
  description?: { text: string | null; html: string | null };
  postedAt?: string | null;
  scrapedAt?: string | null;
  source?: { kind: string };
};

export function getAllJobs(): Job[] {
  return jobs as Job[];
}

export function getJobById(id: string): Job | undefined {
  return (jobs as Job[]).find((j) => j.id === id);
}

export function getFacets(all: Job[]) {
  const companies = uniq(all.map((j) => j.company.name));
  const countries = uniq(all.map((j) => j.locationParsed?.country).filter(Boolean) as string[]);
  const cities = uniq(all.map((j) => j.locationParsed?.city).filter(Boolean) as string[]);
  const workplaces = uniq(all.map((j) => j.workplace).filter(Boolean) as string[]);

  return { companies, countries, cities, workplaces };
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr)).sort((a: any, b: any) => String(a).localeCompare(String(b)));
}
