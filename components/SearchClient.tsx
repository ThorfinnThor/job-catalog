"use client";

import { useMemo, useState } from "react";
import type { Job } from "@/lib/types";
import { JobCard } from "./JobCard";

function uniq(arr: (string | null | undefined)[]) {
  return Array.from(new Set(arr.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

export default function SearchClient({ jobs }: { jobs: Job[] }) {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("");
  const [workplace, setWorkplace] = useState("");

  const companies = useMemo(() => uniq(jobs.map((j) => j.company.name)), [jobs]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    return jobs.filter((j) => {
      if (company && j.company.name !== company) return false;
      if (workplace && (j.workplace ?? "") !== workplace) return false;

      if (!query) return true;

      const hay = [
        j.title,
        j.company.name,
        j.location ?? "",
        j.department ?? "",
        j.team ?? "",
        j.description?.text ?? ""
      ]
        .join(" · ")
        .toLowerCase();

      return hay.includes(query);
    });
  }, [jobs, q, company, workplace]);

  return (
    <>
      <div className="searchBar">
        <input
          className="input"
          placeholder="Search by title, location, department, or keywords…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select className="select" value={company} onChange={(e) => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select className="select" value={workplace} onChange={(e) => setWorkplace(e.target.value)}>
          <option value="">Any workplace</option>
          <option value="remote">remote</option>
          <option value="hybrid">hybrid</option>
          <option value="onsite">onsite</option>
        </select>
      </div>

      <div className="small">
        Tip: press <span className="kbd">Ctrl</span> + <span className="kbd">F</span> for quick in-page find.
      </div>

      <hr className="hr" />

      <div className="small" style={{ marginBottom: 10 }}>
        Showing <strong>{filtered.length}</strong> of <strong>{jobs.length}</strong> jobs
      </div>

      <div className="grid">
        {filtered.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </>
  );
}
