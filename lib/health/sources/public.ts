import { fetchJson, type FetchOutcome, type HttpDeps, type RunCache } from "@/lib/health/sources/http";
import type { ScorecardCheck, SourceStatus } from "@/lib/health/types";

/**
 * Keyless public sources, each verified against its official docs (README → Adoption Check):
 *  - OpenSSF Scorecard API   GET https://api.securityscorecards.dev/projects/github.com/{owner}/{repo}
 *  - OSV.dev                 POST https://api.osv.dev/v1/query  {package:{name, ecosystem}, version?}
 *  - npm registry (latest)   GET https://registry.npmjs.org/{package}/latest
 *  - PyPI JSON (latest)      GET https://pypi.org/pypi/{package}/json
 *  - npm downloads           GET https://api.npmjs.org/downloads/point/last-week/{package}
 *  - pypistats (recent)      GET https://pypistats.org/api/packages/{package}/recent?period=week
 */

export function statusFrom(o: FetchOutcome<unknown>, notFoundReason?: string): SourceStatus {
  if (o.kind === "ok") return { state: "ok", reason: null, at: o.at };
  if (o.kind === "not_found") return { state: "not_available", reason: notFoundReason ?? o.reason, at: o.at };
  if (o.kind === "rate_limited") return { state: "rate_limited", reason: o.reason, at: o.at };
  return { state: "error", reason: o.reason, at: o.at };
}

// ── Scorecard ────────────────────────────────────────────────────────────────
interface ScorecardResponse {
  date: string;
  score: number;
  checks: { name: string; score: number; reason: string | null }[];
}
export interface ScorecardResult {
  status: SourceStatus;
  score: number | null;
  date: string | null;
  checks: ScorecardCheck[];
  url: string;
}
export async function fetchScorecard(fullName: string, deps: HttpDeps, cache?: RunCache): Promise<ScorecardResult> {
  const url = `https://api.securityscorecards.dev/projects/github.com/${fullName}`;
  const o = await fetchJson<ScorecardResponse>(url, {}, deps, cache);
  if (o.kind !== "ok" || typeof o.data?.score !== "number") {
    const status = o.kind === "ok" ? { state: "error" as const, reason: "Unexpected Scorecard response shape", at: o.at } : statusFrom(o, "No Scorecard data for this repository");
    return { status, score: null, date: null, checks: [], url };
  }
  return {
    status: statusFrom(o),
    score: Math.round(o.data.score * 10) / 10,
    date: o.data.date ?? null,
    checks: (o.data.checks ?? []).map((c) => ({ name: c.name, score: typeof c.score === "number" && c.score >= 0 ? c.score : null, reason: c.reason ?? null })),
    url: `https://scorecard.dev/viewer/?uri=github.com/${fullName}`,
  };
}

// ── Registry latest version ─────────────────────────────────────────────────
export async function fetchLatestVersion(ecosystem: "npm" | "pypi", pkg: string, deps: HttpDeps, cache?: RunCache): Promise<{ status: SourceStatus; version: string | null }> {
  if (ecosystem === "npm") {
    const o = await fetchJson<{ version?: string }>(`https://registry.npmjs.org/${pkg}/latest`, {}, deps, cache);
    return { status: statusFrom(o, `npm package "${pkg}" not found`), version: o.kind === "ok" ? (o.data.version ?? null) : null };
  }
  const o = await fetchJson<{ info?: { version?: string } }>(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {}, deps, cache);
  return { status: statusFrom(o, `PyPI package "${pkg}" not found`), version: o.kind === "ok" ? (o.data.info?.version ?? null) : null };
}

// ── OSV ──────────────────────────────────────────────────────────────────────
interface OsvVuln {
  id: string;
  published?: string;
  affected?: { ranges?: { events?: { introduced?: string; fixed?: string }[] }[] }[];
}
interface OsvResponse {
  vulns?: OsvVuln[];
  next_page_token?: string;
}
export interface OsvResult {
  status: SourceStatus;
  total: number | null;
  withFix: number | null;
  publishedLast365: number | null;
  mostRecentPublished: string | null;
  affectingLatest: number | null;
  affectingLatestReason: string | null;
}

async function osvQuery(body: Record<string, unknown>, deps: HttpDeps, cache?: RunCache): Promise<{ outcome: FetchOutcome<OsvResponse>; vulns: OsvVuln[] }> {
  const vulns: OsvVuln[] = [];
  let token: string | undefined;
  let outcome: FetchOutcome<OsvResponse>;
  let pages = 0;
  do {
    outcome = await fetchJson<OsvResponse>("https://api.osv.dev/v1/query", { method: "POST", body: token ? { ...body, page_token: token } : body }, deps, cache);
    if (outcome.kind !== "ok") break;
    vulns.push(...(outcome.data.vulns ?? []));
    token = outcome.data.next_page_token;
  } while (token && ++pages < 5);
  return { outcome, vulns };
}

export async function fetchOsv(ecosystem: "npm" | "pypi", pkg: string, latestVersion: string | null, now: Date, deps: HttpDeps, cache?: RunCache): Promise<OsvResult> {
  const pkgRef = { name: pkg, ecosystem: ecosystem === "npm" ? "npm" : "PyPI" }; // OSV ecosystem names are case-sensitive
  const all = await osvQuery({ package: pkgRef }, deps, cache);
  if (all.outcome.kind !== "ok")
    return { status: statusFrom(all.outcome), total: null, withFix: null, publishedLast365: null, mostRecentPublished: null, affectingLatest: null, affectingLatestReason: null };
  const yearAgo = now.getTime() - 365 * 86_400_000;
  const published = all.vulns.map((v) => v.published).filter((p): p is string => Boolean(p)).sort();
  const result: OsvResult = {
    status: statusFrom(all.outcome),
    total: all.vulns.length,
    withFix: all.vulns.filter((v) => v.affected?.some((a) => a.ranges?.some((r) => r.events?.some((e) => e.fixed)))).length,
    publishedLast365: all.vulns.filter((v) => v.published && new Date(v.published).getTime() >= yearAgo).length,
    mostRecentPublished: published.at(-1) ?? null,
    affectingLatest: null,
    affectingLatestReason: null,
  };
  if (all.vulns.length === 0) {
    result.affectingLatest = 0;
    return result;
  }
  if (!latestVersion) {
    result.affectingLatestReason = "Latest version unknown, so unfixed vulnerabilities could not be checked";
    return result;
  }
  const latest = await osvQuery({ package: pkgRef, version: latestVersion }, deps, cache);
  if (latest.outcome.kind === "ok") result.affectingLatest = latest.vulns.length;
  else result.affectingLatestReason = `OSV version query failed: ${statusFrom(latest.outcome).reason}`;
  return result;
}

// ── Downloads ────────────────────────────────────────────────────────────────
export async function fetchWeeklyDownloads(ecosystem: "npm" | "pypi", pkg: string, deps: HttpDeps, cache?: RunCache): Promise<{ status: SourceStatus; weekly: number | null; source: string; url: string }> {
  if (ecosystem === "npm") {
    const url = `https://api.npmjs.org/downloads/point/last-week/${pkg}`; // scoped names stay unencoded per npm docs
    const o = await fetchJson<{ downloads?: number }>(url, {}, deps, cache);
    const weekly = o.kind === "ok" && typeof o.data.downloads === "number" ? o.data.downloads : null;
    const status = o.kind === "ok" && weekly === null ? { state: "error" as const, reason: "Unexpected npm downloads response", at: o.at } : statusFrom(o, `npm package "${pkg}" has no download data`);
    return { status, weekly, source: "npm (last 7 days)", url: `https://www.npmjs.com/package/${pkg}` };
  }
  const name = pkg.toLowerCase().replace(/[-_.]+/g, "-");
  const o = await fetchJson<{ data?: { last_week?: number } }>(`https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent?period=week`, {}, deps, cache);
  const weekly = o.kind === "ok" && typeof o.data.data?.last_week === "number" ? o.data.data.last_week : null;
  const status = o.kind === "ok" && weekly === null ? { state: "error" as const, reason: "Unexpected pypistats response", at: o.at } : statusFrom(o, `PyPI package "${pkg}" has no download data`);
  return { status, weekly, source: "PyPI via pypistats.org (last week)", url: `https://pypi.org/project/${name}/` };
}
