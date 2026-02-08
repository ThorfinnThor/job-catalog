"use client";

import { useMemo, useState } from "react";
import type { Job } from "@/lib/jobs";

type Props = {
  jobs: Job[];
  facets: {
    companies: string[];
    countries: string[];
    cities: string[];
    workplaces: string[];
  };
  updatedAt?: string | null;
};

export default function SearchClient({ jobs, facets, updatedAt }: Props) {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const [city, setCity] = useState<string>("all");
  const [workplace, setWorkplace] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();

    return jobs.filter((j) => {
      if (company !== "all" && j.company.name !== company) return false;
      if (country !== "all" && (j.locationParsed?.country || "") !== country) return false;
      if (city !== "all" && (j.locationParsed?.city || "") !== city) return false;
      if (workplace !== "all" && (j.workplace || "unknown") !== workplace) return false;

      if (!needle) return true;

      const hay = [
        j.title,
        j.company?.name,
        j.location || "",
        j.locationParsed?.country || "",
        j.locationParsed?.city || "",
        j.department || "",
        j.description?.text || ""
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(needle);
    });
  }, [jobs, q, company, country, city, workplace]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="w-full md:flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
            placeholder="Search title, company, location, department, keywords..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          >
            <option value="all">All companies</option>
            {facets.companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setCity("all"); // reset city when country changes
            }}
          >
            <option value="all">All countries</option>
            {facets.countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="all">All cities</option>
            {facets.cities
              .filter((ct) => {
                if (country === "all") return true;
                // keep only cities that exist under selected country
                return jobs.some((j) => j.locationParsed?.country === country && j.locationParsed?.city === ct);
              })
              .map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
          </select>

          <select
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            value={workplace}
            onChange={(e) => setWorkplace(e.target.value)}
          >
            <option value="all">Any workplace</option>
            {facets.workplaces.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        <div className="text-sm text-white/60">
          <span className="font-medium">Note:</span> Workplace (remote/hybrid/onsite) is{" "}
          <span className="underline decoration-white/20">not always specified</span> by companies. If the source
          doesn’t provide it, we infer it from the posting text; otherwise it may show as <b>unknown</b>.
        </div>

        <div className="text-sm text-white/50">
          Total: <b className="text-white/80">{filtered.length}</b> jobs{" "}
          {updatedAt ? <span>· Updated: {new Date(updatedAt).toLocaleString()}</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map((j) => (
          <a
            key={j.id}
            href={`/jobs/${encodeURIComponent(j.id)}`}
            className="block rounded-2xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition"
          >
            <div className="text-lg font-semibold leading-snug">{j.title}</div>

            <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/70">
              <span className="rounded-full border border-white/10 px-2 py-1">{j.company.name}</span>

              {j.locationParsed?.country ? (
                <span className="rounded-full border border-white/10 px-2 py-1">
                  {j.locationParsed.country}
                  {j.locationParsed.city ? ` · ${j.locationParsed.city}` : ""}
                </span>
              ) : j.location ? (
                <span className="rounded-full border border-white/10 px-2 py-1">{j.location}</span>
              ) : null}

              <span className="rounded-full border border-white/10 px-2 py-1">
                {j.workplace || "unknown"}
                {j.workplaceConfidence ? ` (${j.workplaceConfidence})` : ""}
              </span>

              <span className="rounded-full border border-white/10 px-2 py-1">{j.language.toUpperCase()}</span>
            </div>

            <div className="mt-3 text-sm text-white/60">
              Source: {j.source?.kind || "unknown"} · Scraped:{" "}
              {j.scrapedAt ? new Date(j.scrapedAt).toLocaleString() : "unknown"}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
