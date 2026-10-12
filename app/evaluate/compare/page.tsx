import type { Metadata } from "next";
import Link from "next/link";
import { CopyMarkdownButton } from "@/components/health/copy-markdown";
import { VerdictChip } from "@/components/health/verdict";
import { appBaseUrl } from "@/lib/env";
import { WEIGHTS } from "@/lib/health/config";
import { DIMENSION_LABEL } from "@/lib/health/labels";
import { compareMarkdown } from "@/lib/health/markdown";
import { DIMENSION_ORDER, dimensionBand, headline, strongestPerRow } from "@/lib/health/present";
import { reportsForCompare } from "@/lib/health/queries";

export const metadata: Metadata = { title: "Compare candidates", description: "Side-by-side Adoption Check of up to four open-source projects." };

export default async function ComparePage({ searchParams }: PageProps<"/evaluate/compare">) {
  const sp = await searchParams;
  const raw = typeof sp.ids === "string" ? sp.ids : "";
  const slugs = [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9._-]+$/.test(s)))].slice(0, 4);
  const reports = slugs.length ? await reportsForCompare(slugs) : [];
  const md = compareMarkdown(reports, appBaseUrl());
  const BAND_CLS = { Healthy: "text-ok", Watch: "text-review", Risky: "text-act", "No data": "text-ink-3" } as const;

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6 pt-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/evaluate">Adoption Check</Link> <span className="text-ink-3">/</span> <span className="text-ink-2">Compare</span>
      </nav>
      <h1 className="mt-2 font-display text-[2.4rem] sm:text-[3rem] leading-tight">Side by side</h1>
      {reports.length < 2 ? (
        <div className="card mt-6 p-5 max-w-xl">
          <h2 className="font-semibold">Choose two to four candidates</h2>
          <p className="mt-1 text-ink-2">Tick “Compare” on the watchlist cards, then open the comparison.</p>
          <Link href="/evaluate" className="btn btn-primary mt-4">
            Go to the watchlist
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-ink-2">Rows are ordered by weight. “Strongest” marks the best score in each row.</p>
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
      )}
    </main>
  );
}
