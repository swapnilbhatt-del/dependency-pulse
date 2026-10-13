import type { Metadata } from "next";
import Link from "next/link";
import { WatchlistGrid } from "@/components/health/watchlist-grid";
import { IconAlert, IconCheck, IconQuestion, IconReview } from "@/components/icons";
import { MastNav } from "@/components/mast-nav";
import { watchlist } from "@/lib/health/queries";
import type { Verdict } from "@/lib/health/types";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Adoption Check",
  description: "Health and risk of the open-source projects the team is considering, from live public data, with every verdict explained.",
  alternates: { canonical: "/evaluate" },
  openGraph: { title: "Upstream Weekly · Adoption Check", description: "Health verdicts for open-source projects under evaluation." },
};

const TILES: { v: Verdict; label: string; color: string; icon: React.ReactNode }[] = [
  { v: "healthy", label: "Healthy", color: "var(--mast-ok)", icon: <IconCheck size={14} /> },
  { v: "watch", label: "Watch", color: "var(--mast-review)", icon: <IconReview size={14} /> },
  { v: "risky", label: "Risky", color: "var(--mast-act)", icon: <IconAlert size={14} /> },
  { v: "insufficient", label: "Insufficient data", color: "var(--mast-ink-2)", icon: <IconQuestion size={14} /> },
];

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

export default async function EvaluatePage() {
  let cards: Awaited<ReturnType<typeof watchlist>> = [];
  let failed = false;
  try {
    cards = await watchlist();
  } catch {
    failed = true;
  }
  const total = cards.length;
  const count = (v: Verdict) => cards.filter((c) => c.verdict === v).length;
  const tiles = TILES.filter((t) => t.v !== "insufficient" || count(t.v) > 0);
  const lastChecked = cards.map((c) => c.lastChecked).filter((x): x is string => !!x).sort().at(-1);
  const glow = count("risky") > 0 ? "rgb(255 143 132 / 0.2)" : "rgb(94 234 212 / 0.18)";

  return (
    <main id="main">
      <header className="masthead" style={{ ["--mast-glow" as string]: glow }}>
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 pb-10 sm:pb-14">
          <MastNav />
          <div className="mt-8 sm:mt-12 grid items-end gap-8 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="eyebrow !text-[var(--mast-ok)] enter" style={{ ["--i" as string]: 0 }}>
                Adoption Check
              </p>
              <h1 className="mt-3 font-display text-[2.9rem] sm:text-[4.2rem] leading-[0.98] text-mast-ink enter-soft" style={{ ["--i" as string]: 1 }}>
                Before you adopt it
              </h1>
              <p className="mt-4 max-w-xl text-mast-ink-2 enter-soft" style={{ ["--i" as string]: 2 }}>
                Open-source projects the team is considering, checked weekly from GitHub, OpenSSF Scorecard, OSV and package registries. Scores are computed by fixed rules; each verdict lists the reasons behind it.{" "}
                <Link href="https://github.com/swapnilbhatt-del/upstream-weekly/blob/main/docs/HEALTH_METHOD.md" className="underline underline-offset-2">
                  How verdicts are calculated
                </Link>
                .
              </p>
              <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--mast-line)] px-3 py-1 text-xs font-semibold text-mast-ink-2 enter" style={{ ["--i" as string]: 3 }}>
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--mast-ok)]" aria-hidden="true" />
                Re-checked every Monday · 10:00 IST{lastChecked ? ` · last check ${day(lastChecked)}` : ""}
              </p>
            </div>

            {!failed && total > 0 && (
              <section aria-label="Verdicts at a glance" className="enter" style={{ ["--i" as string]: 3 }}>
                <ul className={`grid gap-2.5 ${tiles.length === 4 ? "grid-cols-2" : "grid-cols-3"}`}>
                  {tiles.map((t) => {
                    const n = count(t.v);
                    return (
                      <li key={t.v} className="stat-tile !min-h-0">
                        <span className="stat-num block !text-[2.6rem]" style={{ color: n ? t.color : "var(--mast-ink-2)" }}>
                          {n}
                        </span>
                        <span className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-mast-ink">
                          <span style={{ color: t.color }}>{t.icon}</span>
                          {t.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3">
                  <div className="dist-bar" aria-hidden="true">
                    {tiles.map((t) => (
                      <span key={t.v} style={{ width: `${(count(t.v) / total) * 100}%`, background: t.color }} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-mast-ink-2 tabular">
                    {total} candidates · {tiles.map((t) => `${count(t.v)} ${t.label.toLowerCase()}`).join(" · ")}
                  </p>
                </div>
              </section>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8">
        {failed ? (
          <div className="card p-5" role="alert">
            <h2 className="font-semibold">The watchlist could not be loaded</h2>
            <p className="mt-1 text-ink-2">The database did not respond. Reload the page to try again.</p>
            <Link href="/evaluate" className="btn btn-secondary mt-4">
              Retry
            </Link>
          </div>
        ) : total === 0 ? (
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
