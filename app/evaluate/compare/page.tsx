import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { CopyMarkdownButton } from "@/components/health/copy-markdown";
import { ScoreRing, VerdictChip } from "@/components/health/verdict";
import { PageMasthead } from "@/components/page-masthead";
import { appBaseUrl } from "@/lib/env";
import { WEIGHTS } from "@/lib/health/config";
import { DIMENSION_LABEL } from "@/lib/health/labels";
import { compareMarkdown } from "@/lib/health/markdown";
import { DIMENSION_ORDER, dimensionBand, headline, strongestPerRow } from "@/lib/health/present";
import { reportsForCompare } from "@/lib/health/queries";

export const metadata: Metadata = { title: "Compare candidates", description: "Side-by-side Adoption Check of up to four open-source projects." };

/** One database read per request, shared by the ring tiles and the table. */
const loadReports = cache((key: string) => (key ? reportsForCompare(key.split(",")) : Promise.resolve([])));
const BAND_CLS = { Healthy: "text-ok", Watch: "text-review", Risky: "text-act", "No data": "text-ink-3" } as const;

async function RingTiles({ ids }: { ids: string }) {
  const reports = await loadReports(ids);
  if (reports.length < 2) return null;
  return (
    <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" aria-label="Candidates in this comparison">
      {reports.map((r) => (
        <li key={r.slug} className="stat-tile !min-h-0 !flex items-center gap-3">
          <ScoreRing score={r.score} verdict={r.verdict} size={56} stroke={5} tone="dark" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-mast-ink" title={r.fullName}>
              {r.fullName}
            </span>
            <span className="mt-1 block">
              <VerdictChip verdict={r.verdict} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function RingTilesSkeleton({ n }: { n: number }) {
  return (
    <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="stat-tile !min-h-0 !flex items-center gap-3">
          <span className="h-14 w-14 shrink-0 rounded-full border-[5px] border-[rgb(255_255_255/0.1)]" />
          <span className="h-4 w-32 rounded-md bg-[rgb(255_255_255/0.09)]" />
        </li>
      ))}
    </ul>
  );
}

function TableSkeleton() {
  return (
    <div className="card overflow-hidden" aria-busy="true">
      <span className="sr-only">Loading the comparison…</span>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="grid grid-cols-[9rem_1fr_1fr] gap-4 border-t border-line p-4 first:border-t-0">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

async function CompareBody({ ids }: { ids: string }) {
  const reports = await loadReports(ids);
  const md = compareMarkdown(reports, appBaseUrl());
  return (
reports.length < 2 ? (
      <div className="card p-5 max-w-xl">
        <h2 className="font-semibold">Choose two to four candidates</h2>
        <p className="mt-1 text-ink-2">Tick “Compare” on the watchlist cards, then open the comparison.</p>
        <Link href="/evaluate" className="btn btn-primary mt-4">
          Go to the watchlist
        </Link>
      </div>
    ) : (
      <>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <CopyMarkdownButton markdown={md} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-[10px] border border-line bg-surface" data-testid="compare-scroll" tabIndex={0} role="region" aria-label="Comparison table, scrolls horizontally">
          <table className="compare-table w-full min-w-[42rem] border-collapse text-sm" data-testid="compare-table">
            <caption className="sr-only">Adoption Check comparison of {reports.map((r) => r.fullName).join(", ")}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-surface p-3 text-left text-xs uppercase tracking-wide text-ink-3">
                  Dimension
                </th>
                {reports.map((r) => (
                  <th key={r.slug} scope="col" className="min-w-[11rem] p-3 text-left align-top">
                    <Link href={`/evaluate/${r.slug}`} className="font-semibold break-all">
                      {r.fullName}
                    </Link>
                    <span className="mt-1.5 block">
                      <VerdictChip verdict={r.verdict} />
                    </span>
                    <span className="mt-1.5 block text-xs font-normal text-ink-3 tabular">
                      Score {r.score ?? "—"} · {Math.round((r.coverage ?? 0) * 100)}% of weight had data
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DIMENSION_ORDER.map((d) => {
                const scores = reports.map((r) => r.dimensions[d].score);
                const best = strongestPerRow(scores);
                return (
                  <tr key={d} className="border-t border-line">
                    <th scope="row" className="sticky left-0 z-10 bg-surface p-3 text-left align-top font-semibold">
                      {DIMENSION_LABEL[d]}
                      <span className="block text-xs font-normal text-ink-3">Weight {WEIGHTS[d]}</span>
                    </th>
                    {reports.map((r, i) => {
                      const s = r.dimensions[d];
                      const band = dimensionBand(s);
                      return (
                        <td key={r.slug} className="p-3 align-top">
                          <span className="block text-ink">{r.metrics ? headline(d, r.metrics) : "Not available"}</span>
                          <span className="bar-track mt-1.5 block" aria-hidden="true">
                            <span style={{ width: `${s.score ?? 0}%`, background: band === "Healthy" ? "var(--ok)" : band === "Watch" ? "var(--review)" : "var(--act)" }} />
                          </span>
                          <span className="mt-1 flex flex-wrap gap-x-2 text-xs tabular">
                            <span className={`font-semibold ${BAND_CLS[band]}`}>{band}</span>
                            <span className="text-ink-3">{s.score ?? "—"}</span>
                            {s.status === "partial" && <span className="text-ink-3">partial</span>}
                            {best.includes(i) && <span className="font-semibold text-ink">★ Strongest</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-surface p-3 text-left align-top font-semibold">
                  Top concern
                </th>
                {reports.map((r) => (
                  <td key={r.slug} className="p-3 align-top text-ink-2">
                    {r.reasons.find((x) => x.tag === "concern")?.text ?? "None recorded."}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-3">Responsiveness is based on samples of recent issues and pull requests. Stars and forks are weak signals. This does not assess code quality or fit for your specific usage.</p>
      </>
    )
  );
}

export default async function ComparePage({ searchParams }: PageProps<"/evaluate/compare">) {
  const sp = await searchParams;
  const raw = typeof sp.ids === "string" ? sp.ids : "";
  const slugs = [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9._-]+$/.test(s)))].slice(0, 4);
  const ids = slugs.join(",");

  // The masthead does not depend on the data, so it streams at once (fast LCP);
  // the ring tiles and the table fill in when the reports arrive.
  return (
    <main id="main">
      <PageMasthead
        maxW="max-w-6xl"
        eyebrow="Adoption Check"
        title="Side by side"
        lede="Rows are ordered by weight. “Strongest” marks the best score in each row. Tick “Compare” on up to four watchlist cards to build a comparison."
        breadcrumb={
          <>
            <Link href="/evaluate" className="underline underline-offset-2">
              Adoption Check
            </Link>{" "}
            <span aria-hidden="true">/</span> <span>Compare</span>
          </>
        }
        aside={
          slugs.length >= 2 ? (
            <Suspense fallback={<RingTilesSkeleton n={slugs.length} />}>
              <RingTiles ids={ids} />
            </Suspense>
          ) : undefined
        }
      />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8">
        <Suspense fallback={<TableSkeleton />}>
          <CompareBody ids={ids} />
        </Suspense>
      </div>
    </main>
  );
}
