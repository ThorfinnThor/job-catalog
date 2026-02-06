export type Workplace = "remote" | "hybrid" | "onsite" | null;
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship" | "temporary" | null;

export type Job = {
  id: string;

  company: {
    id: string;
    name: string;
    careersUrl: string;
  };

  title: string;
  location: string | null;
  workplace: Workplace;
  employmentType: EmploymentType;
  department: string | null;
  team: string | null;

  url: string;
  applyUrl: string | null;

  description: {
    text: string | null;
    html: string | null;
  };

  source: {
    kind: "biontech_html" | "workday_api" | "gsk_playwright" | "html" | "playwright" | "unknown";
    raw?: any;
  };

  postedAt: string | null;
  scrapedAt: string;
};

export type JobsMeta = {
  scrapedAt: string;
  total: number;
  sources: Record<string, number>;
};
