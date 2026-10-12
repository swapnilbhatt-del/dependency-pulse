import "server-only";
import { hasDatabase } from "@/db/client";
import type { Narrative } from "@/lib/health/ai/schema";
import { DIMENSIONS, WEIGHTS, type Dimension } from "@/lib/health/config";
import * as store from "@/lib/health/store";
import type { DimensionScore, GateHit, RawMetrics, Reason, SourceStatus, Verdict } from "@/lib/health/types";

/**
 * Public-safe view models. Team notes, sponsorship/backing, decision reasons
 * and decided_by are removed unless the candidate is explicitly marked public.
 */
export interface CandidateCard {
  id: number;
  slug: string;
  fullName: string;
  intendedUse: string;
  adoptionStatus: store.CandidateRow["adoptionStatus"];
  isExample: boolean;
  verdict: Verdict | null;
  score: number | null;
  coverage: number | null;
  topReasons: Reason[];
  lastChecked: string | null;
  aiStatus: string | null;
}

export interface ReportView extends CandidateCard {
  packageEcosystem: "npm" | "pypi" | null;
  packageName: string | null;
  notesPublic: boolean;
  teamNotes: string | null;
  backing: string | null;
  reasons: Reason[];
  gates: GateHit[];
  dimensions: Record<Dimension, DimensionScore>;
  metrics: RawMetrics | null;
  narrative: (Narrative & { error?: string | null }) | null;
  sources: Partial<Record<string, SourceStatus>>;
  links: Record<string, string>;
  configVersion: string | null;
  refreshNote: string | null;
  trend: { isoWeek: string; capturedAt: string; verdict: Verdict; score: number | null; coverage: number; current: boolean; dimensions: Record<string, DimensionScore> }[];
  decisions: { status: string; decidedAt: string; reason: string | null; decidedBy: string | null }[];
}

function publicReasons(reasons: Reason[], notesPublic: boolean): Reason[] {
  return notesPublic ? reasons : reasons.filter((r) => r.dimension !== "manual");
}

function toCard(c: store.CandidateRow, s: store.SnapshotRow | undefined | null): CandidateCard {
  const reasons = publicReasons(((s?.reasonsJson as Reason[]) ?? []), c.notesPublic);
  return {
    id: c.id,
    slug: c.slug,
    fullName: c.fullName,
    intendedUse: c.intendedUse,
    adoptionStatus: c.adoptionStatus,
    isExample: c.isExample,
    verdict: s?.verdict ?? null,
    score: s?.overallScore ?? null,
    coverage: s?.weightCoverage ?? null,
    topReasons: reasons.slice(0, 2),
    lastChecked: s?.capturedAt.toISOString() ?? null,
    aiStatus: s?.aiStatus ?? null,
  };
}

const VERDICT_ORDER: Record<Verdict, number> = { healthy: 0, watch: 1, risky: 2, insufficient: 3 };

export async function watchlist(): Promise<CandidateCard[]> {
  if (!hasDatabase()) return [];
  const rows = await store.listCandidates();
  const snaps = await store.currentSnapshots(rows.map((r) => r.id));
  return rows
    .map((r) => toCard(r, snaps.get(r.id)))
    .sort((a, b) => (a.verdict ? VERDICT_ORDER[a.verdict] : 9) - (b.verdict ? VERDICT_ORDER[b.verdict] : 9) || (b.score ?? -1) - (a.score ?? -1) || a.fullName.localeCompare(b.fullName));
}

export async function report(slug: string): Promise<ReportView | null> {
  if (!hasDatabase()) return null;
  const c = await store.getCandidateBySlug(slug);
  if (!c) return null;
  const [cur, history, decisions] = await Promise.all([store.currentSnapshot(c.id), store.snapshotHistory(c.id, 12), store.listDecisions(c.id)]);
  const emptyDims = Object.fromEntries(DIMENSIONS.map((d) => [d, { score: null, status: "insufficient", note: "Not checked yet" }])) as Record<Dimension, DimensionScore>;
  return {
    ...toCard(c, cur),
    packageEcosystem: c.packageEcosystem ?? null,
    packageName: c.packageName,
    notesPublic: c.notesPublic,
    teamNotes: c.notesPublic ? c.teamNotes || null : null,
    backing: c.notesPublic && c.sponsorshipOrBacking !== "unknown" ? c.sponsorshipOrBacking : null,
    reasons: publicReasons((cur?.reasonsJson as Reason[]) ?? [], c.notesPublic),
    gates: (cur?.gatesJson as GateHit[]) ?? [],
    dimensions: (cur?.dimensionScoresJson as Record<Dimension, DimensionScore>) ?? emptyDims,
    metrics: (cur?.rawMetricsJson as RawMetrics) ?? null,
    narrative: (cur?.narrativeJson as ReportView["narrative"]) ?? null,
    sources: (cur?.sourceStatusJson as ReportView["sources"]) ?? {},
    links: (cur?.linksJson as Record<string, string>) ?? {},
    configVersion: cur?.configVersion ?? null,
    refreshNote: c.lastRefreshNote,
    trend: history
      .slice()
      .reverse()
      .map((s) => ({ isoWeek: s.isoWeek, capturedAt: s.capturedAt.toISOString(), verdict: s.verdict, score: s.overallScore, coverage: s.weightCoverage, current: s.isCurrent, dimensions: s.dimensionScoresJson as Record<string, DimensionScore> })),
    decisions: decisions.map((d) => ({ status: d.status, decidedAt: d.decidedAt.toISOString(), reason: c.notesPublic ? d.reason : null, decidedBy: c.notesPublic ? d.decidedBy : null })),
  };
}

export async function reportsForCompare(slugs: string[]): Promise<ReportView[]> {
  const out = await Promise.all(slugs.slice(0, 4).map((s) => report(s)));
  return out.filter((r): r is ReportView => r !== null);
}

export function weightOf(d: Dimension): number {
  return WEIGHTS[d];
}
