import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReasonBalance, ReasonTagBadge, ScoreMeter, VerdictChip } from "@/components/health/verdict";
import { IconExternal } from "@/components/icons";
import { DIMENSIONS, HEALTH_CONFIG_VERSION, WEIGHTS } from "@/lib/health/config";
import { ADOPTION_STATUS_LABEL, BACKING_LABEL, DIMENSION_LABEL } from "@/lib/health/labels";
import { listCandidates } from "@/lib/health/store";
import { report } from "@/lib/health/queries";
import { DIMENSION_ORDER, dimensionBand, dimensionMetrics, trendSummary } from "@/lib/health/present";
import { safeSourceUrl } from "@/lib/health/sources/http";
import { VERDICT_LABEL, type Reason } from "@/lib/health/types";
import { hasDatabase } from "@/db/client";

export const revalidate = 300;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  if (!hasDatabase()) return [];
  try {
    return (await listCandidates()).map((c) => ({ slug: c.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps<"/evaluate/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const r = await report(slug).catch(() => null);
  if (!r) return { title: "Candidate not found" };
  const v = r.verdict ? VERDICT_LABEL[r.verdict] : "Not checked yet";
  return { title: `${r.fullName}: ${v}`, description: `Adoption Check for ${r.fullName}: ${v}${r.score !== null ? `, score ${r.score}` : ""}.`, alternates: { canonical: `/evaluate/${slug}` } };
}

const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso)) + " UTC" : "—");
const SOURCE_LABEL: Record<string, string> = { github: "GitHub REST API", scorecard: "OpenSSF Scorecard", osv: "OSV.dev", npm: "npm registry", pypi: "PyPI / pypistats" };
const STATE_LABEL: Record<string, string> = { ok: "Reached", not_available: "Not available", rate_limited: "Rate limited", error: "Error" };

/** Finds the reason a narrative line restates, so each line can cite its source. */
function sourceReason(text: string, reasons: Reason[], tag?: Reason["tag"]): Reason | null {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const t = words(text);
  let best: { r: Reason; score: number } | null = null;
  for (const r of reasons) {
    if (tag && r.tag !== tag) continue;
    const w = words(r.text);
    const overlap = [...w].filter((x) => t.has(x)).length / Math.max(1, w.size);
    if (!best || overlap > best.score) best = { r, score: overlap };
  }
  return best && best.score >= 0.35 ? best.r : null;
}

function NarrativeList({ title, items, reasons, tag }: { title: string; items: string[]; reasons: Reason[]; tag?: Reason["tag"] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="eyebrow">{title}</h3>
      <ul className="mt-2 space-y-2">
        {items.map((s, i) => {
          const src = sourceReason(s, reasons, tag);
          return (
            <li key={i} className="text-sm">
              <p className="text-ink">{s}</p>
              {src && <p className="mt-0.5 text-xs text-ink-3">Source: {src.text}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function ReportPage({ params }: PageProps<"/evaluate/[slug]">) {
  const { slug } = await params;
  const r = await report(slug);
  if (!r) notFound();
  const n = r.narrative;
  const trend = trendSummary(r.trend);
  return (
    <main id="main" className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/evaluate">Adoption Check</Link> <span className="text-ink-3">/</span> <span className="text-ink-2">{r.fullName}</span>
      </nav>

      {/* 1. Header */}
      <header className="card lift mt-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="eyebrow">Adoption Check</p>
            <h1 className="mt-1 font-display text-[2.2rem] sm:text-[2.8rem] leading-tight break-all">{r.fullName}</h1>
            {r.intendedUse && <p className="mt-1 text-ink-2">Intended use: {r.intendedUse}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <VerdictChip verdict={r.verdict} large />
              <span className="chip !min-h-9 !px-3.5 !text-sm">{ADOPTION_STATUS_LABEL[r.adoptionStatus]}</span>
              {r.isExample && <span className="chip chip-dashed !min-h-9">Example candidate, replace me</span>}
              {r.backing && <span className="chip !min-h-9">{BACKING_LABEL[r.backing as keyof typeof BACKING_LABEL]}</span>}
            </div>
            <p className="mt-3 text-sm text-ink-3 tabular">Last checked {fmt(r.lastChecked)} · method {r.configVersion ?? HEALTH_CONFIG_VERSION}</p>
          </div>
          <ScoreMeter score={r.score} coverage={r.coverage} />
        </div>
        {r.refreshNote && (
          <p className="mt-4 rounded-xl border border-review-line bg-review-bg p-3 text-sm" role="note">
            {r.refreshNote}
          </p>
        )}
      </header>

      {!r.verdict ? (
        <p className="card mt-6 p-5 text-ink-2">This candidate has not been checked yet. An admin can run “Refresh health” from the admin page.</p>
      ) : (
        <>
          {/* 2. Decision in one minute */}
          <section aria-labelledby="decision" className="glance lift mt-8 p-5 sm:p-6">
            <h2 id="decision" className="eyebrow text-brand">
              Decision in one minute
            </h2>
            {n && (
              <>
                <p className="mt-3 text-[1.1rem] leading-relaxed measure">{n.summary}</p>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <NarrativeList title="Strengths" items={n.strengths} reasons={r.reasons} tag="positive" />
                  <NarrativeList title="Concerns" items={n.concerns} reasons={r.reasons} tag="concern" />
                </div>
                {n.verify_before_adopting.length > 0 && (
                  <div className="mt-5">
                    <h3 className="eyebrow">Verify before adopting</h3>
                    <ol className="mt-2 space-y-2">
                      {n.verify_before_adopting.map((v, i) => {
                        const src = sourceReason(v, r.reasons, "concern") ?? sourceReason(v, r.reasons);
                        return (
                          <li key={i} className="check-item text-sm">
                            <span className="check-box tabular" aria-hidden="true">
                              {i + 1}
                            </span>
                            <span>
                              <span className="text-ink">{v}</span>
                              {src && <span className="block text-xs text-ink-3">Source: {src.text}</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
                <p className="mt-5 text-sm text-ink-2">
                  <span className="font-semibold">Uncertainty: </span>
                  {n.uncertainty_note}
                </p>
              </>
            )}
            <p className="mt-4 text-xs text-ink-3">
              {r.aiStatus === "ok"
                ? "Written by Gemini Flash from the metrics and reasons below; every number was checked against the data, and the verdict and score come from fixed rules, not the model."
                : r.aiStatus === "fallback"
                  ? "The AI summary could not be validated, so this section was built from the reason list by a template."
                  : "AI summaries are not configured; this section was built from the reason list by a template."}
            </p>
          </section>

          {/* 3. Why this verdict */}
          <section aria-labelledby="why" className="mt-10">
            <p className="eyebrow">Explained</p>
            <h2 id="why" className="mt-1 font-display text-[2rem] keep-next">
              Why this verdict
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <ReasonBalance reasons={r.reasons} />
              <span className="text-xs text-ink-3 tabular">
                Score {r.score ?? "—"} from {Math.round((r.coverage ?? 0) * 100)}% of the weight; {r.gates.length ? `${r.gates.length} hard ${r.gates.length === 1 ? "gate" : "gates"} applied` : "no hard gates applied"}.
              </span>
            </div>
            <ol className="card mt-4 divide-y divide-line">
              {r.reasons.map((x) => (
                <li key={x.id} className="flex gap-3 px-4 py-3 text-sm">
                  <ReasonTagBadge tag={x.tag} />
                  <span className={x.dimension === "gate" ? "font-semibold" : ""}>
                    {x.dimension === "gate" && <span className="sr-only">Hard gate: </span>}
                    {x.text}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* 4. Dimension breakdown */}
          <section aria-labelledby="dims" className="mt-10">
            <p className="eyebrow">Breakdown</p>
            <h2 id="dims" className="mt-1 font-display text-[2rem] keep-next">
              Nine dimensions
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {DIMENSION_ORDER.map((d) => {
                const s = r.dimensions[d];
                const band = dimensionBand(s);
                const rows = r.metrics ? dimensionMetrics(d, r.metrics) : [];
                return (
                  <li key={d} className="card p-4" data-testid="dimension-card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{DIMENSION_LABEL[d]}</h3>
                        <p className="text-xs text-ink-3">Weight {WEIGHTS[d]}</p>
                      </div>
                      <p className="text-right">
                        <span className="font-display text-3xl tabular">{s.score ?? "—"}</span>
                        <span className={`block text-xs font-semibold ${band === "Healthy" ? "text-ok" : band === "Watch" ? "text-review" : band === "Risky" ? "text-act" : "text-ink-3"}`}>{band}</span>
                      </p>
                    </div>
                    {(s.status !== "scored" || s.note) && (
                      <p className="mt-1 text-xs text-ink-3">
                        {s.status === "insufficient" ? "Insufficient data: " : s.status === "partial" ? "Partial data: " : ""}
                        {s.note}
                      </p>
                    )}
                    <details className="mt-1">
                      <summary className="disclosure-summary !min-h-9 text-sm">Source values</summary>
                      <dl className="disclosure-body mt-1 space-y-2 text-sm">
                        {rows.map((m) => (
                          <div key={m.label}>
                            <dt className="text-xs text-ink-3">{m.label}</dt>
                            <dd className={m.missing ? "text-ink-3" : "text-ink"}>
                              {m.value}
                              {m.missing && m.reason ? <span className="block text-xs">{m.reason}</span> : null}
                              {m.note ? <span className="block text-xs text-ink-3">{m.note}</span> : null}
                              <span className="block text-xs text-ink-3">
                                {m.source}
                                {m.fetchedAt ? ` · ${fmt(m.fetchedAt)}` : ""}
                              </span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* 5. Trend */}
          <section aria-labelledby="trend" className="mt-10">
            <p className="eyebrow">Over time</p>
            <h2 id="trend" className="mt-1 font-display text-[2rem] keep-next">
              Trend
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-ink-2">
              {trend.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <ol className="card mt-4 divide-y divide-line" aria-label="Weekly snapshots, oldest first">
              {r.trend.map((s) => (
                <li key={s.isoWeek} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="w-24 font-semibold tabular">{s.isoWeek}</span>
                  <VerdictChip verdict={s.verdict} />
                  <span className="tabular">Score {s.score ?? "—"}</span>
                  <span className="bar-track w-28" aria-hidden="true">
                    <span style={{ width: `${s.score ?? 0}%`, background: "var(--brand)" }} />
                  </span>
                  <span className="text-xs text-ink-3 tabular">{Math.round(s.coverage * 100)}% coverage</span>
                  {s.current && <span className="chip chip-ok">Shown above</span>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {/* 6. Decision log */}
      <section aria-labelledby="decisions" className="mt-10">
        <p className="eyebrow">History</p>
        <h2 id="decisions" className="mt-1 font-display text-[2rem] keep-next">
          Decision log
        </h2>
        {r.decisions.length === 0 ? (
          <p className="card mt-3 p-4 text-ink-2">No decision recorded yet. Status: {ADOPTION_STATUS_LABEL[r.adoptionStatus]}.</p>
        ) : (
          <ol className="card mt-3 divide-y divide-line" data-testid="decision-log">
            {r.decisions.map((d, i) => (
              <li key={i} className="px-4 py-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="chip">{ADOPTION_STATUS_LABEL[d.status as keyof typeof ADOPTION_STATUS_LABEL]}</span>
                  <span className="text-ink-3 tabular">{fmt(d.decidedAt)}</span>
                  {d.decidedBy && <span className="text-ink-2">by {d.decidedBy}</span>}
                  {i === 0 && <span className="text-xs font-semibold text-ink-3">Latest</span>}
                </p>
                <p className="mt-1 text-ink-2">{d.reason ?? <span className="text-ink-3">Reason recorded privately.</span>}</p>
              </li>
            ))}
          </ol>
        )}
        {r.notesPublic && r.teamNotes && (
          <p className="mt-3 text-sm text-ink-2">
            <span className="font-semibold">Team notes: </span>
            {r.teamNotes}
          </p>
        )}
      </section>

      {/* 7. Limits and sources */}
      <footer className="mt-10 rounded-2xl border border-line bg-surface-2 p-5 text-sm text-ink-2 space-y-3">
        <p>
          <span className="font-semibold text-ink">What this does not tell you: </span>
          Does not assess code quality, test coverage, API design, or how well it fits your team&apos;s specific usage. Responsiveness is a sample, stars are a weak signal, and dependents are not collected.
        </p>
        {Object.keys(r.sources).length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Source status">
            {Object.entries(r.sources).map(([k, s]) => (
              <li key={k} className={`chip ${s?.state === "ok" ? "chip-ok" : s?.state === "rate_limited" ? "chip-review" : "chip-dashed"}`} title={s?.reason ?? undefined}>
                {SOURCE_LABEL[k] ?? k}: {STATE_LABEL[s?.state ?? "error"]}
                {s?.reason && s.state !== "ok" ? ` (${s.reason})` : ""}
              </li>
            ))}
          </ul>
        )}
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(r.links).map(([k, url]) => {
            const safe = safeSourceUrl(url);
            return safe ? (
              <a key={k} href={safe} rel="noopener noreferrer" target="_blank" className="inline-flex items-center gap-1">
                {k === "repository" ? "GitHub repository" : k === "scorecard" ? "Scorecard report" : k === "osv" ? "OSV records" : "Package page"} <IconExternal size={12} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null;
          })}
          <Link href="https://github.com/swapnilbhatt-del/dependency-pulse/blob/main/docs/HEALTH_METHOD.md">How to recompute this verdict</Link>
        </p>
        <p className="text-xs text-ink-3">
          Weights: {DIMENSIONS.map((d) => `${DIMENSION_LABEL[d]} ${WEIGHTS[d]}`).join(" · ")}.
        </p>
      </footer>
    </main>
  );
}

