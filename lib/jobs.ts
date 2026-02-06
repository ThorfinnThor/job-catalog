import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Job, JobsMeta } from "./types";

const PUBLIC_DIR = path.join(process.cwd(), "public");

export async function getJobs(): Promise<Job[]> {
  const p = path.join(PUBLIC_DIR, "jobs.json");
  const raw = await readFile(p, "utf8");
  const jobs = JSON.parse(raw) as Job[];
  return jobs;
}

export async function getJobsMeta(): Promise<JobsMeta | null> {
  try {
    const p = path.join(PUBLIC_DIR, "jobs-meta.json");
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as JobsMeta;
  } catch {
    return null;
  }
}

export async function getJobById(id: string): Promise<Job | null> {
  const jobs = await getJobs();
  return jobs.find((j) => j.id === id) ?? null;
}

export function excerpt(text: string | null | undefined, maxLen = 180): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1).trimEnd() + "…";
}
