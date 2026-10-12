import type { Metadata } from "next";
import Link from "next/link";
import { WatchlistGrid } from "@/components/health/watchlist-grid";
import { watchlist } from "@/lib/health/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Adoption Check",
  description: "Health and risk of the open-source projects the team is considering, from live public data, with every verdict explained.",
  alternates: { canonical: "/evaluate" },
  openGraph: { title: "Upstream Weekly · Adoption Check", description: "Health verdicts for open-source projects under evaluation." },
};

export default async function EvaluatePage() {
  let cards: Awaited<ReturnType<typeof watchlist>> = [];
  let failed = false;
  try {
    cards = await watchlist();
  } catch {
    failed = true;
  }
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6 pt-10">
      <p className="eyebrow text-brand">Adoption Check</p>
      <h1 className="mt-2 font-display text-[2.75rem] sm:text-[3.5rem] leading-[1.02]">Before you adopt it</h1>
      <p className="mt-3 max-w-2xl text-ink-2">
        Open-source projects the team is considering, checked weekly from GitHub, OpenSSF Scorecard, OSV and package registries. Scores are computed by fixed rules; each verdict lists the reasons behind it.{" "}
        <Link href="https://github.com/swapnilbhatt-del/dependency-pulse/blob/main/docs/HEALTH_METHOD.md">How verdicts are calculated</Link>.
      </p>
      <div className="mt-8">
        {failed ? (
          <div className="card p-5" role="alert">
            <h2 className="font-semibold">The watchlist could not be loaded</h2>
            <p className="mt-1 text-ink-2">The database did not respond. Reload the page to try again.</p>
            <Link href="/evaluate" className="btn btn-secondary mt-4">
              Retry
            </Link>
          </div>
        ) : cards.length === 0 ? (
          <div className="card p-6 sm:p-8 max-w-2xl" data-testid="watchlist-empty">
            <h2 className="font-display text-3xl">No candidates yet</h2>
            <p className="mt-2 text-ink-2">
              A candidate is an open-source project you are thinking of depending on, such as a JWT library or a payments SDK. Add its GitHub repository (and npm or PyPI package, if it has one) and Adoption Check reports its release cadence, maintenance,
              responsiveness, bus factor, licensing, security posture and known vulnerabilities.
            </p>
            <Link href="/admin/evaluate" className="btn btn-primary mt-5">
              Add a candidate
            </Link>
          </div>
        ) : (
          <WatchlistGrid cards={cards} />
        )}
      </div>
    </main>
  );
}
