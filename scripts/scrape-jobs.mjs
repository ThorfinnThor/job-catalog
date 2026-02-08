// web/pages/pharma-intelligence.tsx
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { loadIndex, loadMeta } from "@/lib/data";
import { DatasetMeta, TrialIndexRow, UrlState } from "@/lib/types";
import { encodeState } from "@/lib/urlState";
import { isLikelyScientificFailure, parsePhases, phaseLabel, reasonBucket } from "@/lib/filtering";

/**
 * Mobile responsiveness strategy (robust on iOS Safari):
 * - Any truly wide content is inside an explicit horizontal scroll region with touch-friendly settings.
 * - "Reason buckets": stays a table but forces overflow via min-width on the table.
 * - "Phase × bucket matrix": desktop = table; mobile = per-phase horizontal card strips
 *   (avoids scroll-freeze issues caused by sticky table cells inside overflow containers on mobile Safari).
 *
 * Original features preserved:
 * - Header KPIs + window + confidence breakdown
 * - Quick totals cards + fast drill-down links
 * - Failure taxonomy: buckets + phase×bucket
 * - Indication landscape: disease area + top conditions (+ exclude healthy toggle)
 * - Sponsor intelligence: sponsor selector + top buckets/phases/disease areas + explore drill-downs
 */

type BucketKey = string;
type PhaseKey = string;

type BucketStat = {
  bucket: BucketKey;
  total: number;
  bio: number;
  bioShare: number;
};

type PhaseBucketCell = {
  phase: PhaseKey;
  bucket: BucketKey;
  total: number;
  bio: number;
};

type SimpleRow = {
  key: string;
  label: string;
  total: number;
  bio: number;
  bioShare: number;
};

type SponsorProfile = {
  sponsor: string;
  rows: TrialIndexRow[];
  total: number;
  bio: number;
  bioShare: number;
  topBuckets: { bucket: string; count: number }[];
  topPhases: { phase: string; count: number }[];
  topAreas: { area: string; count: number }[];
};

function normEntity(s?: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function safePct(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

function confKey(s?: string): "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" {
  const v = (s || "").toUpperCase().trim();
  if (v === "HIGH") return "HIGH";
  if (v === "MEDIUM") return "MEDIUM";
  if (v === "LOW") return "LOW";
  return "UNKNOWN";
}

function exploreHref(patch: Partial<UrlState>): string {
  const base: UrlState = { sort: "date_desc" };
  return `/explore${encodeState({ ...base, ...patch })}`;
}

function TopK<T>(arr: T[], k: number): T[] {
  return arr.slice(0, Math.max(0, k));
}


/**
 * =========================
 * PHASE NORMALIZATION
 * =========================
 */
const PHASE_ORDER: string[] = [
  "EARLY_PHASE1",
  "PHASE1",
  "PHASE1/PHASE2",
  "PHASE2",
  "PHASE2/PHASE3",
  "PHASE3",
  "PHASE4",
  "UNKNOWN"
];

const CANON_PHASES = new Set(PHASE_ORDER);

function normalizePhaseToken(p: string): PhaseKey {
  const u = (p || "").toUpperCase().trim();
  if (!u) return "UNKNOWN";
  return CANON_PHASES.has(u) ? u : "UNKNOWN";
}

function representativePhase(r: TrialIndexRow): PhaseKey {
  const raw = parsePhases(r.phases || "");
  if (!raw.length) return "UNKNOWN";
  const tokens = Array.from(new Set(raw.map(normalizePhaseToken)));
  tokens.sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b));
  return tokens[0] || "UNKNOWN";
}

/**
 * =========================
 * CONDITION NORMALIZATION
 * =========================
 */
function normalizeConditionKey(s: string): string {
  const t = (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[()]/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const compact = t.replace(/\s+/g, "");
  if (compact === "covid19" || compact === "covid2019" || compact === "coronavirusdisease2019") return "covid-19";
  return t;
}

function canonicalConditionLabel(key: string, fallback: string): string {
  if (key === "covid-19") return "COVID-19";
  return fallback || key;
}

function isHealthyConditionKey(key: string): boolean {
  const k = (key || "").toLowerCase().trim();
  return (
    k === "healthy" ||
    k === "healthy volunteers" ||
    k === "healthy volunteer" ||
    k === "healthy subjects" ||
    k === "healthy subject"
  );
}

/**
 * =========================
 * BUCKET POLICY
 * =========================
 * Keep parity with the original intent: do not show ENROLLMENT as its own bucket here.
 * Collapse ENROLLMENT -> OTHER/UNKNOWN for all computations on this page.
 */
const CORE_BUCKETS: BucketKey[] = ["EFFICACY/FUTILITY", "SAFETY", "OPERATIONAL", "REGULATORY", "OTHER/UNKNOWN"];

function normalizeBucketForDisplay(b: string): BucketKey {
  const u = (b || "").toUpperCase().trim() || "OTHER/UNKNOWN";
  if (u === "ENROLLMENT") return "OTHER/UNKNOWN";
  return u as BucketKey;
}

/**
 * Helper: choose Explore filter strategy for sponsor/condition.
 * Explore currently supports q + status/phase/area/bucket/bio.
 * So sponsor/condition drill-downs are implemented via q search.
 */
function sponsorQueryHref(leadSponsor: string, scientificOnly?: boolean, patch?: Partial<UrlState>): string {
  return exploreHref({ q: leadSponsor, ...(scientificOnly ? { bio: true } : {}), ...(patch || {}) });
}

function conditionQueryHref(conditionLabel: string, patch?: Partial<UrlState>): string {
  return exploreHref({ q: conditionLabel, ...(patch || {}) });
}

/**
 * Simple bucket tag styling (works with global theme vars).
 */
function bucketPillClass(bucket: string): string {
  const b = (bucket || "").toUpperCase();
  if (b === "SAFETY") return "pill pillSafety";
  if (b === "EFFICACY/FUTILITY") return "pill pillEfficacy";
  if (b === "OPERATIONAL") return "pill pillOperational";
  if (b === "REGULATORY") return "pill pillRegulatory";
  return "pill pillNeutral";
}

function phasePillClass(phase: string): string {
  const p = (phase || "").toUpperCase();
  if (p.includes("PHASE1") || p === "EARLY_PHASE1") return "pill pillPhase1";
  if (p.includes("PHASE2")) return "pill pillPhase2";
  if (p.includes("PHASE3")) return "pill pillPhase3";
  if (p.includes("PHASE4")) return "pill pillPhase4";
  return "pill pillNeutral";
}

export default function PharmaIntelligencePage() {
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [allRows, setAllRows] = useState<TrialIndexRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [focusBio, setFocusBio] = useState<boolean>(false);

  // Sponsor selection
  const [selectedSponsor, setSelectedSponsor] = useState<string>("");

  // Sponsor selector w/ typeahead
  const [sponsorQuery, setSponsorQuery] = useState<string>("");
  const [sponsorMenuOpen, setSponsorMenuOpen] = useState<boolean>(false);
  const sponsorBoxRef = useRef<HTMLDivElement | null>(null);

  // Exclude "Healthy" toggle (applies to global top conditions only)
  const [excludeHealthy, setExcludeHealthy] = useState<boolean>(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const [m, idx] = await Promise.all([loadMeta(), loadIndex()]);
        if (!alive) return;
        setMeta(m);
        setAllRows(idx);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load dataset.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    if (!focusBio) return allRows;
    return allRows.filter((r) => isLikelyScientificFailure(r));
  }, [allRows, focusBio]);

  const totals = useMemo(() => {
    const total = allRows.length;
    const bio = allRows.filter((r) => isLikelyScientificFailure(r)).length;

    const byConf: Record<"HIGH" | "MEDIUM" | "LOW" | "UNKNOWN", number> = {
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      UNKNOWN: 0
    };

    for (const r of allRows) {
      if (!isLikelyScientificFailure(r)) continue;
      byConf[confKey(r.classification_confidence)] += 1;
    }

    let minDate = "";
    let maxDate = "";
    for (const r of allRows) {
      const d = (r.last_update_post_date || r.date || "").slice(0, 10);
      if (!d) continue;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }

    return { total, bio, bioShare: total > 0 ? bio / total : 0, byConf, minDate, maxDate };
  }, [allRows]);

  /**
   * =========================
   * Failure taxonomy: bucket stats (ENROLLMENT collapsed)
   * =========================
   */
  const bucketStatsAll = useMemo<BucketStat[]>(() => {
    const map = new Map<string, { total: number; bio: number }>();

    for (const r of rows) {
      const b = normalizeBucketForDisplay(reasonBucket(r) || "");
      if (!map.has(b)) map.set(b, { total: 0, bio: 0 });
      const cur = map.get(b)!;
      cur.total += 1;
      if (isLikelyScientificFailure(r)) cur.bio += 1;
    }

    const out: BucketStat[] = Array.from(map.entries()).map(([bucket, v]) => ({
      bucket,
      total: v.total,
      bio: v.bio,
      bioShare: v.total > 0 ? v.bio / v.total : 0
    }));

    out.sort((a, b) => b.total - a.total);
    return out;
  }, [rows]);

  const displayedBuckets = useMemo<BucketKey[]>(() => {
    const extras = bucketStatsAll
      .filter((b) => !CORE_BUCKETS.includes(b.bucket) && b.total > 0)
      .map((b) => b.bucket);

    // Keep core buckets first; append extras; ENROLLMENT already collapsed
    return [...CORE_BUCKETS, ...extras];
  }, [bucketStatsAll]);

  const bucketStats = useMemo<BucketStat[]>(() => {
    const m = new Map<string, BucketStat>();
    for (const b of bucketStatsAll) m.set(b.bucket, b);
    return displayedBuckets.map((bucket) => m.get(bucket) || { bucket, total: 0, bio: 0, bioShare: 0 });
  }, [bucketStatsAll, displayedBuckets]);

  const bucketMax = useMemo(() => Math.max(1, ...bucketStats.map((b) => b.total)), [bucketStats]);

  /**
   * =========================
   * Failure taxonomy: phase keys
   * =========================
   */
  const phaseKeys = useMemo<PhaseKey[]>(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(representativePhase(r));
    const arr = Array.from(s);
    arr.sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b));
    return arr.length ? arr : ["UNKNOWN"];
  }, [rows]);

  /**
   * =========================
   * Failure taxonomy: phase × bucket matrix
   * =========================
   */
  const phaseBucketMatrix = useMemo(() => {
    const m = new Map<PhaseKey, Map<BucketKey, { total: number; bio: number }>>();

    for (const p of phaseKeys) {
      const inner = new Map<BucketKey, { total: number; bio: number }>();
      for (const b of displayedBuckets) inner.set(b, { total: 0, bio: 0 });
      m.set(p, inner);
    }

    for (const r of rows) {
      const p = representativePhase(r);
      const b = normalizeBucketForDisplay(reasonBucket(r) || "");
      if (!m.has(p)) {
        const inner = new Map<BucketKey, { total: number; bio: number }>();
        for (const bb of displayedBuckets) inner.set(bb, { total: 0, bio: 0 });
        m.set(p, inner);
      }
      const inner = m.get(p)!;
      if (!inner.has(b)) inner.set(b, { total: 0, bio: 0 });
      const cell = inner.get(b)!;
      cell.total += 1;
      if (isLikelyScientificFailure(r)) cell.bio += 1;
    }

    const cells: PhaseBucketCell[] = [];
    for (const p of phaseKeys) {
      const inner = m.get(p);
      if (!inner) continue;
      for (const b of displayedBuckets) {
        const v = inner.get(b) || { total: 0, bio: 0 };
        cells.push({ phase: p, bucket: b, total: v.total, bio: v.bio });
      }
    }
    return cells;
  }, [rows, phaseKeys, displayedBuckets]);

  const matrixMax = useMemo(() => Math.max(1, ...phaseBucketMatrix.map((c) => c.total)), [phaseBucketMatrix]);

  /**
   * =========================
   * Indication landscape
   * =========================
   */
  const diseaseAreaStats = useMemo<SimpleRow[]>(() => {
    const map = new Map<string, { total: number; bio: number }>();
    for (const r of rows) {
      const a = normEntity(r.disease_area || "Other/Unknown") || "Other/Unknown";
      if (!map.has(a)) map.set(a, { total: 0, bio: 0 });
      const cur = map.get(a)!;
      cur.total += 1;
      if (isLikelyScientificFailure(r)) cur.bio += 1;
    }

    const out: SimpleRow[] = Array.from(map.entries()).map(([key, v]) => ({
      key,
      label: key,
      total: v.total,
      bio: v.bio,
      bioShare: v.total > 0 ? v.bio / v.total : 0
    }));

    out.sort((a, b) => b.total - a.total);
    return TopK(out, 12);
  }, [rows]);

  const topConditionStats = useMemo<SimpleRow[]>(() => {
    const map = new Map<string, { total: number; bio: number; label: string }>();

    for (const r of rows) {
      const c0 = normEntity(r.condition_first || "");
      if (!c0) continue;

      const key = normalizeConditionKey(c0);
      if (!key) continue;
      if (excludeHealthy && isHealthyConditionKey(key)) continue;

      if (!map.has(key)) map.set(key, { total: 0, bio: 0, label: c0 });
      const cur = map.get(key)!;
      cur.total += 1;
      if (isLikelyScientificFailure(r)) cur.bio += 1;
    }

    const out: SimpleRow[] = Array.from(map.entries()).map(([key, v]) => ({
      key,
      label: canonicalConditionLabel(key, v.label),
      total: v.total,
      bio: v.bio,
      bioShare: v.total > 0 ? v.bio / v.total : 0
    }));

    out.sort((a, b) => b.total - a.total);
    return TopK(out, 14);
  }, [rows, excludeHealthy]);

  /**
   * =========================
   * Sponsor intelligence
   * =========================
   */
  const sponsorList = useMemo(() => {
    const s = new Set<string>();
    for (const r of allRows) {
      const sp = normEntity(r.lead_sponsor);
      if (sp) s.add(sp);
    }
    const arr = Array.from(s);
    arr.sort((a, b) => a.localeCompare(b));
    return arr;
  }, [allRows]);

  const sponsorSuggestions = useMemo(() => {
    const q = (sponsorQuery || "").trim().toLowerCase();
    const pool = sponsorList;

    if (!q) return pool.slice(0, 50);

    // prefer prefix matches, then substring matches
    const prefix: string[] = [];
    const sub: string[] = [];
    for (const s of pool) {
      const sl = s.toLowerCase();
      if (sl.startsWith(q)) prefix.push(s);
      else if (sl.includes(q)) sub.push(s);
    }
    return [...prefix, ...sub].slice(0, 50);
  }, [sponsorQuery, sponsorList]);

  useEffect(() => {
    if (!selectedSponsor && sponsorList.length) setSelectedSponsor(sponsorList[0]);
  }, [selectedSponsor, sponsorList]);

  // Keep input in sync with selected sponsor
  useEffect(() => {
    setSponsorQuery(selectedSponsor || "");
  }, [selectedSponsor]);

  // Close sponsor menu on outside click / escape
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = sponsorBoxRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setSponsorMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSponsorMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const sponsorProfile = useMemo<SponsorProfile | null>(() => {
    const sponsor = normEntity(selectedSponsor);
    if (!sponsor) return null;

    // Respect focusBio toggle: the page is a "mode"; sponsor summaries follow it.
    const sRows = rows.filter((r) => normEntity(r.lead_sponsor) === sponsor);
    const total = sRows.length;
    const bio = sRows.filter((r) => isLikelyScientificFailure(r)).length;
    const bioShare = total > 0 ? bio / total : 0;

    const bucketCounts = new Map<string, number>();
    const phaseCounts = new Map<string, number>();
    const areaCounts = new Map<string, number>();

    for (const r of sRows) {
      const b = normalizeBucketForDisplay(reasonBucket(r) || "");
      bucketCounts.set(b, (bucketCounts.get(b) || 0) + 1);

      const p = representativePhase(r);
      phaseCounts.set(p, (phaseCounts.get(p) || 0) + 1);

      const a = normEntity(r.disease_area || "Other/Unknown") || "Other/Unknown";
      areaCounts.set(a, (areaCounts.get(a) || 0) + 1);
    }

    const topBuckets = Array.from(bucketCounts.entries())
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const topPhases = Array.from(phaseCounts.entries())
      .map(([phase, count]) => ({ phase, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const topAreas = Array.from(areaCounts.entries())
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return { sponsor, rows: sRows, total, bio, bioShare, topBuckets, topPhases, topAreas };
  }, [rows, selectedSponsor]);

  const sponsorBucketMax = useMemo(() => Math.max(1, ...(sponsorProfile?.topBuckets.map((x) => x.count) || [0])), [sponsorProfile]);
  const sponsorPhaseMax = useMemo(() => Math.max(1, ...(sponsorProfile?.topPhases.map((x) => x.count) || [0])), [sponsorProfile]);
  const sponsorAreaMax = useMemo(() => Math.max(1, ...(sponsorProfile?.topAreas.map((x) => x.count) || [0])), [sponsorProfile]);

  // Precompute for wide table min-width (desktop)
  const matrixMinWidth = useMemo(() => {
    // Phase col (~180) + per-bucket col (~150)
    return 180 + displayedBuckets.length * 150;
  }, [displayedBuckets.length]);

  if (loading) {
    return (
      <>
        <Head>
          <title>Pharma intelligence</title>
        </Head>
        <div className="min-h-screen">
          <header className="topbar">
            <div className="topbar-inner">
              <div className="topbar-left">
                <Link href="/explore" className="brand">
                  Clinical trial failures
                </Link>
                <nav className="nav" aria-label="Primary">
                  <Link className="navlink" href="/explore">
                    Explore
                  </Link>
                  <Link className="navlink" href="/pharma-intelligence" aria-current="page">
                    Pharma intelligence
                  </Link>
                  <Link className="navlink" href="/outliers">
                    Outliers
                  </Link>
                  <Link className="navlink" href="/share-leaders">
                    Share leaders
                  </Link>
                  <Link className="navlink" href="/methods">
                    Methods
                  </Link>
                </nav>
              </div>
            </div>
          </header>

          <div className="page">
            <div className="card p-4">Loading…</div>
          </div>
        </div>
      </>
    );
  }

  if (err) {
    return (
      <>
        <Head>
          <title>Pharma intelligence</title>
        </Head>
        <div className="min-h-screen">
          <header className="topbar">
            <div className="topbar-inner">
              <div className="topbar-left">
                <Link href="/explore" className="brand">
                  Clinical trial failures
                </Link>
                <nav className="nav" aria-label="Primary">
                  <Link className="navlink" href="/explore">
                    Explore
                  </Link>
                  <Link className="navlink" href="/pharma-intelligence" aria-current="page">
                    Pharma intelligence
                  </Link>
                  <Link className="navlink" href="/outliers">
                    Outliers
                  </Link>
                  <Link className="navlink" href="/share-leaders">
                    Share leaders
                  </Link>
                  <Link className="navlink" href="/methods">
                    Methods
                  </Link>
                </nav>
              </div>
            </div>
          </header>
          <div className="page">
            <div className="card p-4">
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Error</div>
              <div className="muted">{err}</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Pharma intelligence</title>
      </Head>

      <div className="min-h-screen">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="topbar-left">
              <Link href="/explore" className="brand">
                Clinical trial failures
              </Link>
              <nav className="nav" aria-label="Primary">
                <Link className="navlink" href="/explore">
                  Explore
                </Link>
                <Link className="navlink" href="/pharma-intelligence" aria-current="page">
                  Pharma intelligence
                </Link>
                  <Link className="navlink" href="/outliers">
                    Outliers
                  </Link>
                  <Link className="navlink" href="/share-leaders">
                  Share leaders
                </Link>
                <Link className="navlink" href="/methods">
                  Methods
                </Link>
              </nav>
            </div>
          </div>
        </header>

        <div className="page">
          {/* ===== Header ===== */}
          <header className="header">
            <div className="headerLeft">
              <h1 className="title">Pharma intelligence</h1>
              <div className="muted subtitle">
                Snapshot derived from stopped interventional drug/biologic trials on ClinicalTrials.gov (API v2). Use Explore for full filtering.
              </div>
            </div>

            <div className="headerRight">
              <div className="chip">
                Trials&nbsp;<b>{totals.total.toLocaleString()}</b>
              </div>
              <div className="chip">
                Bio share&nbsp;<b>{safePct(totals.bioShare)}</b>
              </div>
              <div className="chip">
                Window&nbsp;
                <b>
                  {totals.minDate || "—"} → {totals.maxDate || "—"}
                </b>
              </div>

              <button className={focusBio ? "btn-primary" : "btn"} onClick={() => setFocusBio((v) => !v)}>
                {focusBio ? "Showing scientific failures" : "Show scientific failures"}
              </button>
            </div>
          </header>

          {/* ===== Quick totals ===== */}
          <section className="grid3" aria-label="Quick totals">
            <div className="card p-4">
              <div className="muted small">Stopped trials</div>
              <div className="kpi">{totals.total.toLocaleString()}</div>
              <div className="muted small" style={{ marginTop: 4 }}>
                Interventional, drug/biologic only.
              </div>
            </div>

            <div className="card p-4">
              <div className="muted small">Likely scientific failures</div>
              <div className="kpi">{totals.bio.toLocaleString()}</div>
              <div className="muted small" style={{ marginTop: 4 }}>
                Conservative rule-based label.
              </div>
            </div>

            <div className="card p-4">
              <div className="muted small">Confidence breakdown (bio subset)</div>

              {/* Mobile (unchanged): compact inline breakdown */}
              <div className="miniRow" aria-label="Confidence breakdown">
                <div className="miniLabel">HIGH</div>
                <div className="miniVal">{totals.byConf.HIGH.toLocaleString()}</div>
                <div className="miniLabel">MED</div>
                <div className="miniVal">{totals.byConf.MEDIUM.toLocaleString()}</div>
                <div className="miniLabel">LOW</div>
                <div className="miniVal">{totals.byConf.LOW.toLocaleString()}</div>
                <div className="miniLabel">UNK</div>
                <div className="miniVal">{totals.byConf.UNKNOWN.toLocaleString()}</div>
              </div>

              {/* Desktop: 2×2 stat tiles for clean pairing/alignment */}
              <div className="confGrid" aria-label="Confidence breakdown (2 by 2)">
                <div className="confCell">
                  <div className="confLabel">HIGH</div>
                  <div className="confVal">{totals.byConf.HIGH.toLocaleString()}</div>
                </div>
                <div className="confCell">
                  <div className="confLabel">MED</div>
                  <div className="confVal">{totals.byConf.MEDIUM.toLocaleString()}</div>
                </div>
                <div className="confCell">
                  <div className="confLabel">LOW</div>
                  <div className="confVal">{totals.byConf.LOW.toLocaleString()}</div>
                </div>
                <div className="confCell">
                  <div className="confLabel">UNK</div>
                  <div className="confVal">{totals.byConf.UNKNOWN.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className="card p-4">
              <div className="muted small">Fast drill-down</div>
              <div className="muted small" style={{ marginTop: 4 }}>
                Open Explore with pre-applied filters.
              </div>
              <div className="btnRow" style={{ marginTop: 12 }}>
                <Link className="btn btnBucketEfficacy" href={exploreHref({ bucket: ["EFFICACY/FUTILITY"] })}>
                  Efficacy/Futility
                </Link>
                <Link className="btn btnBucketSafety" href={exploreHref({ bucket: ["SAFETY"] })}>
                  Safety
                </Link>
                <Link className="btn btnBucketOperational" href={exploreHref({ bucket: ["OPERATIONAL"] })}>
                  Operational
                </Link>
                <Link className="btn btnBucketRegulatory" href={exploreHref({ bucket: ["REGULATORY"] })}>
                  Regulatory
                </Link>
              </div>
            </div>
          </section>

          {/* ===== Failure taxonomy ===== */}
          <section className="section" aria-label="Failure taxonomy">
            <div className="sectionHead">
              <h2 className="h2">Failure taxonomy</h2>
              <div className="muted small">
                Buckets prefer pipeline field <code>classification_reason</code>; heuristic fallback uses <code>why_stopped_short</code>.
              </div>
            </div>

            <div className="grid2">
              {/* Reason buckets */}
              <div className="card p-4">
                <div className="panelTitleRow">
                  <h3 className="h3">Reason buckets</h3>
                  <div className="muted small">Enrollment is collapsed into Other/Unknown on this page.</div>
                </div>

                <div className="scrollHint">Swipe horizontally →</div>
                <div className="hScroll hScrollMini" role="region" aria-label="Reason buckets (horizontally scrollable)" tabIndex={0}>
                  <div className="hScrollInner">
                    <table className="tblMini tblReason" aria-label="Reason buckets table">
                      <thead>
                        <tr>
                          <th>Bucket</th>
                          <th className="num">Trials</th>
                          <th className="num">Bio share</th>
</tr>
                      </thead>
                      <tbody>
                        {bucketStats.map((b) => (
                          <tr key={b.bucket}>
                            <td>
                              <div className="cellTop">
                                <span className={bucketPillClass(b.bucket)}>{b.bucket}</span>
                                <Link className="link exploreInline" href={exploreHref({ bucket: [b.bucket], bio: focusBio ? true : undefined })}>
                                  Explore
                                </Link>
                              </div>
                              <div className="muted tiny" style={{ marginTop: 4 }}>
                                {b.bio.toLocaleString()} likely scientific failures
                              </div>
                              <div className="cellSub">
                                <Link className="link" href={exploreHref({ bucket: [b.bucket], bio: focusBio ? true : undefined })}>
                                  Explore →
                                </Link>
                              </div>
                            </td>
                            <td className="num">{b.total.toLocaleString()}</td>
                            <td className="num">{safePct(b.bioShare)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="note">
                  Notes: this view is designed for quick directional insight. For production analysis, always confirm the pipeline fields on the trial detail page.
                </div>
              </div>

              {/* Phase × bucket matrix */}
              <div className="card p-4">
                <div className="panelTitleRow">
                  <h3 className="h3">Phase × bucket matrix</h3>
                  <div className="muted small">Mobile uses swipeable cards per phase (more reliable than scrollable tables on iOS).</div>
                </div>

                {/* Desktop/table version */}
                <div className="desktopOnly">
                  <div className="scrollHint">Scroll horizontally →</div>
                  <div className="hScroll" role="region" aria-label="Phase by bucket matrix (scrollable)" tabIndex={0}>
                    <div className="hScrollInner">
                      <table className="tblMatrix" style={{ minWidth: matrixMinWidth }} aria-label="Phase by bucket matrix">
                        <thead>
                          <tr>
                            <th>Phase</th>
                            {displayedBuckets.map((b) => (
                              <th key={b} title={b} className="bucketHead">
                                {b}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {phaseKeys.map((p) => (
                            <tr key={p}>
                              <td className="phaseCell">
                                <span className={phasePillClass(p)}>{phaseLabel(p)}</span>
                                <div className="muted tiny">{p}</div>
                              </td>

                              {displayedBuckets.map((b) => {
                                const cell = phaseBucketMatrix.find((x) => x.phase === p && x.bucket === b);
                                const total = cell?.total || 0;
                                const bio = cell?.bio || 0;

                                const href = exploreHref({ phase: [p], bucket: [b], bio: focusBio ? true : undefined });

                                return (
                                  <td key={`${p}_${b}`} className="matrixCell">
                                    <Link className="cellLink" href={href}>
                                      <div className="cellNums">
                                        <span className="big">{total.toLocaleString()}</span>
                                        {!focusBio && <span className="muted tiny">{bio.toLocaleString()} bio</span>}
                                      </div>
                                      <div className="cellBarTrack" aria-hidden="true">
                                        <div className="cellBarFill" style={{ width: `${(total / matrixMax) * 100}%` }} />
                                      </div>
                                    </Link>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="note">
                    Counting uses a single representative phase per trial (avoids double counting multi-phase records).
                  </div>
                </div>

                {/* Mobile version */}
                <div className="mobileOnly">
                  {phaseKeys.map((p) => {
                    return (
                      <div key={p} className="phaseRow">
                        <div className="phaseRowHead">
                          <span className={phasePillClass(p)}>{phaseLabel(p)}</span>
                          <span className="muted tiny">{p}</span>
                        </div>

                        <div className="bucketStrip" role="region" aria-label={`${phaseLabel(p)} buckets`} tabIndex={0}>
                          {displayedBuckets.map((b) => {
                            const cell = phaseBucketMatrix.find((x) => x.phase === p && x.bucket === b);
                            const total = cell?.total || 0;
                            const bio = cell?.bio || 0;

                            const href = exploreHref({ phase: [p], bucket: [b], bio: focusBio ? true : undefined });

                            return (
                              <Link key={`${p}_${b}`} href={href} className="bucketCard">
                                <div className="bucketCardTop">
                                  <span className={bucketPillClass(b)}>{b}</span>
                                </div>
                                <div className="bucketCardNum">{total.toLocaleString()}</div>
                                {!focusBio && <div className="muted tiny">{bio.toLocaleString()} bio</div>}
                                <div className="cardBarTrack" aria-hidden="true">
                                  <div className="cardBarFill" style={{ width: `${(total / matrixMax) * 100}%` }} />
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ===== Indication landscape ===== */}
          <section className="section" aria-label="Indication landscape">
            <div className="sectionHead">
              <h2 className="h2">Indication landscape</h2>
              <div className="muted small">Derived from compact index fields (first condition per trial).</div>
            </div>

            <div className="grid2">
              <div className="card p-4">
                <div className="panelTitleRow">
                  <h3 className="h3">By disease area</h3>
                  <div className="muted small">Top areas by volume.</div>
                </div>

                <div className="hScroll vScroll hScrollMini" role="region" aria-label="Disease area table" tabIndex={0}>
                  <div className="hScrollInner">
                    <table className="tblMini tblWide" aria-label="Disease area table">
                      <thead>
                        <tr>
                          <th>Disease area</th>
                          <th className="num">Trials</th>
                          <th className="num">Bio share</th>
</tr>
                      </thead>
                      <tbody>
                        {diseaseAreaStats.map((a) => (
                          <tr key={a.key}>
                            <td>
                              <div className="cellTop">
                                <span className="pill pillNeutral">{a.label}</span>
                                <Link className="link exploreInline" href={exploreHref({ area: [a.key], bio: focusBio ? true : undefined })}>
                                  Explore
                                </Link>
                              </div>
                              <div className="muted tiny" style={{ marginTop: 4 }}>
                                {a.bio.toLocaleString()} likely scientific failures
                              </div>
                              <div className="cellSub">
                                <Link className="link" href={exploreHref({ area: [a.key], bio: focusBio ? true : undefined })}>
                                  Explore →
                                </Link>
                              </div>
                            </td>
                            <td className="num">{a.total.toLocaleString()}</td>
                            <td className="num">{safePct(a.bioShare)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="note">Disease area drill-down uses the Explore “area” filter.</div>
              </div>

              <div className="card p-4">
                <div className="panelTitleRow">
                  <h3 className="h3">Top conditions</h3>
                  <label className="chip" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={excludeHealthy}
                      onChange={(e) => setExcludeHealthy(e.target.checked)}
                      style={{ marginRight: 8 }}
                    />
                    Exclude “Healthy”
                  </label>
                </div>

                <div className="hScroll vScroll hScrollMini" role="region" aria-label="Top conditions table" tabIndex={0}>
                  <div className="hScrollInner">
                    <table className="tblMini tblWide" aria-label="Top conditions table">
                      <thead>
                        <tr>
                          <th>Condition</th>
                          <th className="num">Trials</th>
                          <th className="num">Bio share</th>
</tr>
                      </thead>
                      <tbody>
                        {topConditionStats.map((c) => (
                          <tr key={c.key}>
                            <td>
                              <div className="cellTop">
                                <span className="pill pillNeutral">{c.label}</span>
                                <Link className="link exploreInline" href={conditionQueryHref(c.label, { bio: focusBio ? true : undefined })}>
                                  Explore
                                </Link>
                              </div>
                              <div className="muted tiny" style={{ marginTop: 4 }}>
                                {c.bio.toLocaleString()} likely scientific failures
                              </div>
                              <div className="cellSub">
                                <Link className="link" href={conditionQueryHref(c.label, { bio: focusBio ? true : undefined })}>
                                  Explore →
                                </Link>
                              </div>
                            </td>
                            <td className="num">{c.total.toLocaleString()}</td>
                            <td className="num">{safePct(c.bioShare)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="note">
                  Condition drill-down uses Explore free-text search (q). For more complete condition analysis, extend the index to include full condition lists.
                </div>
              </div>
            </div>
          </section>

          {/* ===== Sponsor intelligence ===== */}
          <section className="section" aria-label="Sponsor intelligence">
            <div className="sectionHead">
              <h2 className="h2">Sponsor intelligence</h2>
              <div className="muted small">Sponsor drill-downs use Explore free-text search (q) plus bucket/phase/area where applicable.</div>
            </div>

            <div className="card p-4">
              <div className="sponsorTopRow">
                <div className="sponsorSelect">
                  <div className="muted small" style={{ marginBottom: 6 }}>
                    Sponsor
                  </div>
                  <div ref={sponsorBoxRef} className="comboWrap">
                    <input
                      className="input"
                      value={sponsorQuery}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSponsorQuery(v);
                        setSponsorMenuOpen(true);
                      }}
                      onFocus={() => setSponsorMenuOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const first = sponsorSuggestions[0] || "";
                          const exact = sponsorList.find((s) => s.toLowerCase() === sponsorQuery.trim().toLowerCase());
                          const next = exact || first;
                          if (next) {
                            setSelectedSponsor(next);
                            setSponsorMenuOpen(false);
                          }
                        }
                        if (e.key === "ArrowDown") setSponsorMenuOpen(true);
                      }}
                      placeholder="Type a sponsor…"
                      aria-label="Sponsor"
                    />

                    {sponsorMenuOpen && sponsorSuggestions.length ? (
                      <div className="comboMenu" role="listbox" aria-label="Sponsor suggestions">
                        {sponsorSuggestions.slice(0, 12).map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="comboItem"
                            role="option"
                            onMouseDown={(ev) => {
                              // Prevent input blur before selection
                              ev.preventDefault();
                              setSelectedSponsor(s);
                              setSponsorMenuOpen(false);
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="sponsorBtns">
                  <Link className="btn" href={sponsorQueryHref(selectedSponsor, focusBio)}>
                    Open in Explore
                  </Link>
                  <button className={focusBio ? "btn-primary" : "btn"} onClick={() => setFocusBio((v) => !v)}>
                    {focusBio ? "Showing scientific failures" : "Show scientific failures"}
                  </button>
                </div>
              </div>


  {sponsorProfile && (
    <div className="sponsorGrid">
      <div className="sponsorLeft">
        <div className="sPanel sponsorTotals">
          <div className="subhead">Sponsor totals</div>
          <div className="panelTitle">{sponsorProfile.sponsor}</div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Trials: <b>{sponsorProfile.total.toLocaleString()}</b> • Bio share: <b>{safePct(sponsorProfile.bioShare)}</b>
          </div>

          <div className="note" style={{ marginTop: 12 }}>
            The sponsor panel follows the current page mode (all trials vs scientific failures).
          </div>
        </div>

        <div className="sponsorLeftLower">
          <div className="sPanel sPanelBuckets">
            <div className="panelTitleRow">
              <div className="subhead">Top buckets</div>
              <Link className="link" href={sponsorQueryHref(sponsorProfile.sponsor, focusBio)}>
                View all →
              </Link>
            </div>

            <div className="sPanelBody">
              <table className="compactTbl" aria-label="Sponsor top buckets table">
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th style={{ width: 110, textAlign: "right" }}>Trials</th>
                  </tr>
                </thead>
                <tbody>
                  {sponsorProfile.topBuckets.map((x) => (
                    <tr key={x.bucket}>
                      <td>
                        <Link
                          className="link cellTrunc"
                          href={sponsorQueryHref(sponsorProfile.sponsor, focusBio, { bucket: [x.bucket] })}
                        >
                          {x.bucket}
                        </Link>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 800 }}>{x.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="sPanel sPanelPhases">
            <div className="panelTitleRow">
              <div className="subhead">Top phases</div>
              <Link className="link" href={sponsorQueryHref(sponsorProfile.sponsor, focusBio)}>
                View all →
              </Link>
            </div>

            <div className="sPanelBody">
              <table className="compactTbl" aria-label="Sponsor top phases table">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th style={{ width: 110, textAlign: "right" }}>Trials</th>
                  </tr>
                </thead>
                <tbody>
                  {sponsorProfile.topPhases.map((x) => (
                    <tr key={x.phase}>
                      <td>
                        <Link
                          className="link cellTrunc"
                          href={sponsorQueryHref(sponsorProfile.sponsor, focusBio, { phase: [x.phase] })}
                        >
                          {phaseLabel(x.phase)}
                        </Link>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 800 }}>{x.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="sPanel sPanelAreas">
        <div className="panelTitleRow">
          <div className="subhead">Top disease areas</div>
          <Link className="link" href={sponsorQueryHref(sponsorProfile.sponsor, focusBio)}>
            View all →
          </Link>
        </div>

        <div className="sPanelBody">
          <table className="compactTbl" aria-label="Sponsor top disease areas table">
            <thead>
              <tr>
                <th>Disease area</th>
                <th style={{ width: 110, textAlign: "right" }}>Trials</th>
              </tr>
            </thead>
            <tbody>
              {sponsorProfile.topAreas.map((x) => (
                <tr key={x.area}>
                  <td>
                    <Link
                      className="link cellTrunc"
                      href={sponsorQueryHref(sponsorProfile.sponsor, focusBio, { area: [x.area] })}
                    >
                      {x.area}
                    </Link>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{x.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )}
</div>
          </section>

          {/* ===== Footer ===== */}
          <footer className="footer muted">
            Dataset version: <b>{meta?.version || "—"}</b>
            {meta?.generated_at_utc ? (
              <>
                {" "}
                • Generated: <b>{meta.generated_at_utc}</b>
              </>
            ) : null}
            {meta?.source ? (
              <>
                {" "}
                • Source: <b>{meta.source}</b>
              </>
            ) : null}
          </footer>
        </div>
      </div>

      <style jsx>{`
        .header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .headerLeft {
          min-width: 0;
          flex: 1 1 520px;
        }
        .headerRight {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        .title {
          margin: 0;
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.02em;
        }
        .subtitle {
          margin-top: 4px;
          font-size: 13px;
          line-height: 1.35;
        }

        .section {
          margin-top: 18px;
        }
        .sectionHead {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 900;
        }
        .h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 900;
        }

        .small {
          font-size: 12px;
          line-height: 1.35;
        }
        .tiny {
          font-size: 11px;
          line-height: 1.25;
        }

        code {
          font-size: 0.95em;
        }

        .grid3 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 18px;
          /* Mobile/tablet: allow natural heights */
          align-items: start;
        }
        .grid2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        /* Desktop: use more horizontal real estate without affecting mobile layouts. */
        @media (min-width: 1100px) {
          :global(.page) {
            max-width: 1320px;
            margin-left: auto;
            margin-right: auto;
          }
        }


        /* Wide desktop: show all 4 KPI cards in one row */
        @media (min-width: 1180px) {
          .grid3 {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          /* Drill-down: compact 2×2 button grid */
          .btnRow {
            display: grid !important;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }
          .btnRow .btn {
            width: 100%;
            justify-content: center;
          }
        }

        .kpi {
          margin-top: 4px;
          font-size: 28px;
          font-weight: 900;
          letter-spacing: -0.02em;
        }

        .miniRow {
          margin-top: 10px;
          display: grid;
          grid-template-columns: auto auto auto auto auto auto auto auto;
          gap: 6px 10px;
          align-items: center;
          font-size: 12px;
        }
        .miniLabel {
          color: var(--text-muted);
          font-weight: 900;
          letter-spacing: 0.06em;
        }
        .miniVal {
          font-weight: 850;
        }

        .confGrid {
          display: none; /* mobile unchanged */
          margin-top: 10px;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .confCell {
          border: 1px solid var(--border);
          background: rgba(15, 23, 42, 0.02);
          border-radius: 14px;
          padding: 10px 12px;
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        .confLabel {
          color: var(--text-muted);
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-size: 11px;
          line-height: 1.2;
        }
        .confVal {
          font-weight: 950;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
        }

        /* Desktop: replace inline strip with 2×2 stat tiles */
        @media (min-width: 981px) {
          /* Desktop-only: avoid wasted "gutter" whitespace inside scroll regions.
             Base styles use overflow-x: scroll and scrollbar-gutter: stable both-edges.
             On Windows (non-overlay scrollbars), that can reserve extra space and make
             the mini tables look like they have a lot of empty room.

             On desktop we switch to overflow-x: auto (no forced empty scrollbar) and
             reserve a single stable gutter on the right (not both edges) so all scroll
             regions keep identical inner widths without creating extra blank space. */
          .hScroll {
            overflow-x: auto;
            overflow-y: auto;
            scrollbar-gutter: stable;
            touch-action: pan-x pan-y;
          }

          .miniRow {
            display: none;
          }
          .confGrid {
            display: grid;
          }

          /* Desktop KPI row: make all 4 cards equal height */
          .grid3 {
            align-items: stretch;
          }
          .grid3 > .card {
            height: 100%;
            display: flex;
            flex-direction: column;
          }

          /* Balance vertical rhythm inside equal-height KPI cards */
          .grid3 > .card .kpi + .muted.small {
            margin-top: auto !important;
          }
          .grid3 > .card .btnRow {
            margin-top: auto;
          }
          .grid3 > .card .confGrid {
            margin-top: auto;
          }
          /* Desktop: align numeric columns across all mini tables (Reason buckets, Disease area, Conditions, etc.)
             The main culprit was vertical scrollbar gutter in vScroll tables causing a narrower content box.
             Fix: ensure all mini table scroll regions reserve a stable vertical gutter on desktop and use a shared fixed column schema. */
          .hScrollMini {
            overflow-y: auto; /* makes it a y-scroll container, enabling stable gutter even when not overflowing */
            scrollbar-gutter: stable; /* reserve space so vScroll and non-vScroll regions have identical inner widths */
          }

          .tblMini {
            min-width: 0; /* remove mobile overflow forcing on desktop */
            table-layout: fixed;
          }
          .tblMini.tblWide,
          .tblMini.tblReason {
            min-width: 0;
            width: 100%;
          }

          /* Shared column widths: [label] | trials | bio share | bar */
          .tblMini.tblWide th:nth-child(2),
          .tblMini.tblWide td:nth-child(2),
          .tblMini.tblReason th:nth-child(2),
          .tblMini.tblReason td:nth-child(2) {
            width: 112px;
          }
          .tblMini.tblWide th:nth-child(3),
          .tblMini.tblWide td:nth-child(3),
          .tblMini.tblReason th:nth-child(3),
          .tblMini.tblReason td:nth-child(3) {
            width: 88px;
          }

        }

        .btnRow {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        /* Match bucket pill colors for the Fast drill-down buttons. */
        :global(.btn.btnBucketEfficacy) {
          background: rgba(79, 70, 229, 0.10) !important;
          border-color: rgba(79, 70, 229, 0.25) !important;
        }
        :global(.btn.btnBucketSafety) {
          background: rgba(220, 38, 38, 0.08) !important;
          border-color: rgba(220, 38, 38, 0.25) !important;
        }
        :global(.btn.btnBucketOperational) {
          background: rgba(234, 179, 8, 0.12) !important;
          border-color: rgba(234, 179, 8, 0.25) !important;
        }
        :global(.btn.btnBucketRegulatory) {
          background: rgba(2, 132, 199, 0.10) !important;
          border-color: rgba(2, 132, 199, 0.25) !important;
        }

        :global(.btn.btnBucketEfficacy:hover),
        :global(.btn.btnBucketSafety:hover),
        :global(.btn.btnBucketOperational:hover),
        :global(.btn.btnBucketRegulatory:hover) {
          filter: brightness(0.98);
        }

        :global(.btn.btnBucketEfficacy:active),
        :global(.btn.btnBucketSafety:active),
        :global(.btn.btnBucketOperational:active),
        :global(.btn.btnBucketRegulatory:active) {
          filter: brightness(0.95);
        }
        
        :global(.btn.btnBucketEfficacy:focus-visible),
        :global(.btn.btnBucketSafety:focus-visible),
        :global(.btn.btnBucketOperational:focus-visible),
        :global(.btn.btnBucketRegulatory:focus-visible) {
          outline: none;
          box-shadow: 0 0 0 4px rgba(15, 23, 42, 0.08);
        }

        .panelTitleRow {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }

        .note {
          margin-top: 12px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.02);
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.35;
        }

        .scrollHint {
          display: none;
          color: var(--text-muted);
          font-weight: 750;
          font-size: 12px;
          margin-bottom: 10px;
        }

        .hScroll {
          width: 100%;
          max-width: 100%;
          overflow-x: scroll;
          scrollbar-gutter: stable both-edges;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
          border-radius: 12px;
          transform: translateZ(0);
        }

        /* Desktop: clamp long tables inside cards and allow vertical scrolling. */
        @media (min-width: 721px) {
          .hScroll.vScroll {
            max-height: 520px;
            overflow-y: auto;
            /* allow both axes when a user scrolls inside the table region */
            touch-action: pan-x pan-y;
            overscroll-behavior: contain;
          }

          /* Keep headers visible while scrolling vertically inside the card */
          .hScroll.vScroll thead th {
            position: sticky;
            top: 0;
            background: #fff;
            z-index: 2;
          }
        }

        .hScrollInner {
          display: block;
          width: 100%;
          padding-bottom: 2px;
        }
        .hScrollInner > table {
          width: 100%;
        }

        /* ====== Pill tags ====== */
        .pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 850;
          letter-spacing: 0.01em;
          border: 1px solid var(--border);
          background: var(--surface);
          line-height: 1;
          white-space: nowrap;
        }
        .pillNeutral {
          background: rgba(15, 23, 42, 0.02);
        }
        .pillSafety {
          background: rgba(220, 38, 38, 0.08);
          border-color: rgba(220, 38, 38, 0.25);
        }
        .pillEfficacy {
          background: rgba(79, 70, 229, 0.10);
          border-color: rgba(79, 70, 229, 0.25);
        }
        .pillOperational {
          background: rgba(234, 179, 8, 0.12);
          border-color: rgba(234, 179, 8, 0.25);
        }
        .pillRegulatory {
          background: rgba(2, 132, 199, 0.10);
          border-color: rgba(2, 132, 199, 0.25);
        }
        .pillPhase1 {
          background: rgba(14, 165, 233, 0.10);
          border-color: rgba(14, 165, 233, 0.25);
        }
        .pillPhase2 {
          background: rgba(16, 185, 129, 0.10);
          border-color: rgba(16, 185, 129, 0.25);
        }
        .pillPhase3 {
          background: rgba(168, 85, 247, 0.10);
          border-color: rgba(168, 85, 247, 0.25);
        }
        .pillPhase4 {
          background: rgba(244, 63, 94, 0.10);
          border-color: rgba(244, 63, 94, 0.25);
        }

        /* ====== Tables ====== */
        .tblMini {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          min-width: 640px;
        }
        .tblMini th,
        .tblMini td {
          border-bottom: 1px solid var(--border);
          padding: 8px 10px;
          vertical-align: top;
        }
        .tblMini th {
          text-align: left;
          font-size: 12px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          white-space: nowrap;
        }
        .tblMini th.num {
          text-align: right;
        }
        .tblWide {
          min-width: 720px;
        }
        .tblReason {
          min-width: 760px; /* ensure overflow on phones */
        }
        .num {
          text-align: right;
          white-space: nowrap;
          font-weight: 800;
        }

        .cellTop {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .cellSub {
          margin-top: 4px;
          font-size: 12px;
        }

        .exploreInline {
          margin-left: auto;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }

        /* Desktop: keep "Explore" on the primary row and reduce vertical noise.
           Mobile remains unchanged (the inline link is hidden). */
        @media (min-width: 721px) {
          .cellSub {
            display: none;
          }
          .exploreInline {
            opacity: 0;
            pointer-events: none;
            transition: opacity 120ms ease;
          }
          .tblMini tbody tr:hover .exploreInline,
          .tblMini tbody tr:focus-within .exploreInline {
            opacity: 1;
            pointer-events: auto;
          }
        }

        .link {
          color: rgba(79, 70, 229, 0.92);
          font-weight: 750;
        }
        .link:hover {
          text-decoration: underline;
        }

        /* ====== Matrix table (desktop) ====== */
        .tblMatrix {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .tblMatrix th,
        .tblMatrix td {
          border-bottom: 1px solid var(--border);
          padding: 10px 10px;
          vertical-align: top;
        }
        .tblMatrix th {
          text-align: left;
          font-size: 12px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          white-space: nowrap;
        }
        .bucketHead {
          min-width: 150px;
        }
        .phaseCell {
          min-width: 180px;
        }
        .matrixCell {
          min-width: 150px;
        }

        .cellLink {
          display: block;
          border-radius: 12px;
          padding: 8px;
          background: rgba(15, 23, 42, 0.02);
        }
        .cellLink:hover {
          background: rgba(79, 70, 229, 0.06);
        }
        .cellNums {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }
        .big {
          font-weight: 900;
        }
        .cellBarTrack {
          margin-top: 8px;
          height: 8px;
          background: rgba(15, 23, 42, 0.08);
          border-radius: 999px;
          overflow: hidden;
        }
        .cellBarFill {
          height: 100%;
          background: rgba(79, 70, 229, 0.55);
          border-radius: 999px;
        }

        /* ====== Mobile matrix (per-phase bucket strip) ====== */
        .phaseRow {
          padding: 10px 0 14px;
          border-bottom: 1px solid var(--border);
        }
        .phaseRow:last-child {
          border-bottom: none;
        }
        .phaseRowHead {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }
        .bucketStrip {
          display: flex;
          scroll-snap-type: x proximity;
          gap: 10px;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
          padding-bottom: 4px;
        }
        .bucketCard {
          flex: 0 0 auto;
          scroll-snap-align: start;
          width: 210px;
          border: 1px solid var(--border);
          background: var(--surface);
          border-radius: 14px;
          padding: 12px;
          box-shadow: var(--shadow-soft);
        }
        .bucketCard:active {
          transform: scale(0.99);
        }
        .bucketCardTop {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .bucketCardNum {
          margin-top: 10px;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: -0.02em;
        }
        .cardBarTrack {
          margin-top: 10px;
          height: 8px;
          background: rgba(15, 23, 42, 0.08);
          border-radius: 999px;
          overflow: hidden;
        }
        .cardBarFill {
          height: 100%;
          background: rgba(79, 70, 229, 0.55);
          border-radius: 999px;
        }

        /* ===== Sponsor typeahead ===== */
        .comboWrap {
          position: relative;
        }
        .comboMenu {
          position: absolute;
          left: 0;
          right: 0;
          top: calc(100% + 6px);
          z-index: 60;
          border: 1px solid var(--border);
          border-radius: 14px;
          background: var(--surface);
          box-shadow: var(--shadow-soft);
          max-height: 280px;
          overflow: auto;
          padding: 6px;
        }
        .comboItem {
          width: 100%;
          text-align: left;
          border: 0;
          background: transparent;
          padding: 10px 10px;
          border-radius: 10px;
          font-size: 13px;
          cursor: pointer;
        }
        .comboItem:hover {
          background: rgba(79, 70, 229, 0.06);
        }
        .comboItem:active {
          background: rgba(79, 70, 229, 0.10);
        }

        /* ===== Sponsor ===== */
        .sponsorTopRow {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }
        .sponsorSelect {
          flex: 1 1 520px;
          min-width: 280px;
        }
        .sponsorBtns {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .sponsorPanels3 {
          display: grid;
          grid-template-columns: 1.15fr 1fr 1fr;
          gap: 14px;
          align-items: start;
          margin-top: 10px;
        }

        
        .sponsorGrid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
          align-items: start;
          margin-top: 10px;
        }
        .sponsorLeft {
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-width: 0;
        }
        .sponsorLeftLower {
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-width: 0;
        }

        @media (min-width: 900px) {
          .sponsorGrid {
            grid-template-columns: minmax(380px, 460px) 1fr;
            column-gap: 16px;
            row-gap: 14px;
          }
          .sponsorLeft {
            grid-column: 1;
          }
          .sPanelAreas {
            grid-column: 2;
          }
        }

        @media (min-width: 1100px) {
          .sponsorLeftLower {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
          }
          .sPanelAreas .sPanelBody {
            max-height: 520px;
            overflow: auto;
          }
          .sPanelAreas thead th {
            position: sticky;
            top: 0;
            z-index: 2;
          }
        }

        .sPanelBody {
          margin-top: 6px;
        }
        .sPanel {
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 14px;
          min-width: 0;
          overflow: hidden;
        }
        .subhead {
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .panelTitle {
          font-weight: 900;
          font-size: 16px;
          margin-top: 2px;
          line-height: 1.2;
        }
        .compactTbl {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          table-layout: fixed;
        }
        .compactTbl th,
        .compactTbl td {
          border-bottom: 1px solid var(--border);
          padding: 10px 10px;
          vertical-align: top;
        }
        .compactTbl th {
          text-align: left;
          font-size: 12px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          background: var(--surface);
        }
        .cellTrunc {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          display: block;
        }

        .footer {
          margin-top: 18px;
          font-size: 12px;
        }

        /* Visibility toggles */
        .mobileOnly {
          display: none;
        }
        .desktopOnly {
          display: block;
        }

        @media (max-width: 1100px) {
          .sponsorPanels3 {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 980px) {
          .grid3 {
            grid-template-columns: 1fr;
          }
          .grid2 {
            grid-template-columns: 1fr;
          }
          .scrollHint {
            display: block;
          }
        }

        @media (max-width: 820px) {
          .sponsorPanels3 {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .title {
            font-size: 20px;
          }
          .subtitle {
            font-size: 12px;
          }


/* Mobile: prevent iOS Safari flex-wrap gap in the page header.
   On some Safari builds, a wrapping flex header can create a large internal
   vertical gap that pushes the second flex line (chips/button) far down.
   The robust fix is to stop using flex for the header on phones. */
.header {
  display: block !important;
}
.headerRight {
  width: 100%;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start !important;
  gap: 10px;
}
.headerRight .chip {
  width: 100%;
}
.headerRight button {
  width: 100%;
  justify-content: center;
}
          .h2 {
            font-size: 15px;
          }
          .h3 {
            font-size: 13px;
          }

          /* Tighten section spacing on phones */
          .section {
            margin-top: 14px;
          }

          /* Mobile: avoid negative margins (can clip on devices where the parent padding isn't 16px).
             Keep scroll areas contained so the right edge is always reachable. */
          .hScroll {
            margin: 0;
            padding: 0;
          }

          /* Mobile: keep horizontal scroll tables as intrinsic-width */
          .hScrollInner {
            display: inline-block;
            min-width: max-content;
          }
          .hScrollInner > table {
            width: max-content;
          }

          /* Mobile: hide bar column to keep header/value alignment tight */
          .tblMini.tblWide th:nth-child(4),
          .tblMini.tblWide td:nth-child(4),
          .tblMini.tblReason th:nth-child(4),
          .tblMini.tblReason td:nth-child(4) {
            display: none;
          }
          /* Ensure page respects safe areas and doesn't clip the right edge */
          :global(.page) {
            padding-left: max(12px, env(safe-area-inset-left));
            padding-right: max(12px, env(safe-area-inset-right));
          }

          /* Reduce card padding on mobile to tighten layout */
          :global(.p-4) {
            padding: 12px;
          }

          /* Prevent any grid children from forcing overflow */
          .grid2 > *,
          .grid3 > * {
            min-width: 0;
          }

          .tblMini {
            font-size: 12px;
          }
          .tblMini th,
          .tblMini td {
            padding: 8px 8px;
          }

          /* Ensure the reason buckets table keeps overflow visible on mobile */
          .tblReason {
            min-width: 760px;
          }

          .miniRow {
            grid-template-columns: repeat(4, auto);
          }
          /* Mobile: keep "Explore →" on its own line; hide the inline link. */
          .exploreInline {
            display: none;
          }



          .desktopOnly {
            display: none;
          }
          .mobileOnly {
            display: block;
          }

          /* Sponsor controls stack nicely */
          .sponsorTopRow {
            flex-direction: column;
            align-items: stretch;
          }
          .sponsorSelect {
            min-width: 0;
            flex: 0 0 auto;
            width: 100%;
          }
          .sponsorBtns {
            width: 100%;
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
          :global(.sponsorBtns .btn),
          :global(.sponsorBtns .btn-primary) {
            width: 100%;
            justify-content: center;
          }
          .bucketCard {
            width: 200px;
            padding: 11px;
          }
          .bucketCardNum {
            font-size: 18px;
          }
        }
      `}</style>
    </>
  );
}
