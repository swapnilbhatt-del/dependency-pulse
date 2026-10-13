import Link from "next/link";
import { CountRow } from "@/components/digest/count-row";
import { WeekBar } from "@/components/digest/week-bar";
import { IconAlert, IconArrowRight, IconCheck, IconReview, IconShield, IconSparkle, PulseLine } from "@/components/icons";

const I = (i: number) => ({ ["--i" as string]: i });
import { MastNav } from "@/components/mast-nav";
import type { DigestModel } from "@/lib/digest/model";
import { fmtWeekOf, fmtWindow } from "@/lib/digest/format";
import { getLatestDigest, listDigests } from "@/lib/digest/queries";
import { watchlist } from "@/lib/health/queries";

export const revalidate = 300;

function LatestCard({ d }: { d: DigestModel }) {
  const top = d.act[0] ?? d.review[0];
  return (
    <div className="rounded-2xl border border-[var(--mast-line)] bg-[rgb(255_255_255/0.05)] p-5 backdrop-blur enter" style={I(4)}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mast-ink-2">Latest digest · {d.isoWeek}</p>
      <p className="mt-2 font-display text-3xl text-mast-ink">Week of {fmtWeekOf(d.weekOf)}</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { n: d.counts.act, l: "Act now", c: "var(--mast-act)" },
          { n: d.counts.review, l: "Review", c: "var(--mast-review)" },
          { n: d.counts.fyi, l: "FYI", c: "var(--mast-ink)" },
        ].map((x) => (
          <div key={x.l} className="rounded-xl border border-[var(--mast-line)] px-2 py-3">
            <p className="stat-num !text-4xl" style={{ color: x.n ? x.c : "var(--mast-ink-2)" }}>
              {x.n}
            </p>
            <p className="mt-1 text-xs font-semibold text-mast-ink-2">{x.l}</p>
          </div>
        ))}
      </div>
      {top && (
        <div className="mt-4 rounded-xl border border-[var(--mast-line)] p-3.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: top.tier === 1 ? "var(--mast-act)" : "var(--mast-review)" }}>
            {top.tier === 1 ? <IconAlert size={12} /> : <IconReview size={12} />} {top.tier === 1 ? "Top item · Act now" : "Top item · Review"}
          </p>
          <p className="mt-1.5 font-semibold text-mast-ink">
            {top.repo} <span className="font-mono text-sm font-normal">{top.tag}</span>
          </p>
          <p className="mt-1 text-sm text-mast-ink-2 line-clamp-2">{top.summary}</p>
        </div>
      )}
      <Link href={`/digest/${d.isoWeek}`} className="btn btn-primary mt-4 w-full !bg-[#f3f5f7] !text-[#0d1117] hover:!bg-white">
        Read this week&apos;s digest <IconArrowRight />
      </Link>
    </div>
  );
}

export default async function Home() {
  const [latest, weeks, candidates] = await Promise.all([getLatestDigest().catch(() => null), listDigests(6).catch(() => []), watchlist().catch(() => [])]);
  const verdictCount = (v: string) => candidates.filter((c) => c.verdict === v).length;
  return (
    <main id="main">
      <header className="masthead" style={{ ["--mast-glow" as string]: latest?.counts.act ? "rgb(255 143 132 / 0.22)" : "rgb(94 234 212 / 0.18)" }}>
        <PulseLine className="pulse-line" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pb-14 sm:pb-20">
          <MastNav />
          <div className="mt-10 sm:mt-16 grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[var(--mast-line)] px-3 py-1 text-xs font-semibold text-mast-ink-2 enter" style={I(0)}>
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--mast-ok)]" aria-hidden="true" />
                Every Monday · 09:00 IST
              </p>
              <h1 className="mt-5 font-display text-[3rem] sm:text-[4.5rem] leading-[0.98] text-mast-ink enter-soft" style={I(1)}>
                The releases that matter, <em className="not-italic text-[var(--mast-act)]">first</em>.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-mast-ink-2 enter-soft" style={I(2)}>
                One calm digest of every release across the open-source libraries your product runs on. Security fixes and breaking changes lead, with the evidence quoted. Everything else fits in a line.
              </p>
              <div className="mt-7 flex flex-wrap gap-3 enter" style={I(3)}>
                {latest ? (
                  <Link href={`/digest/${latest.isoWeek}`} className="btn btn-primary !bg-[#f3f5f7] !text-[#0d1117] hover:!bg-white">
                    Read the latest digest <IconArrowRight />
                  </Link>
                ) : (
                  <Link href="/archive" className="btn btn-primary !bg-[#f3f5f7] !text-[#0d1117] hover:!bg-white">
                    Open the archive <IconArrowRight />
                  </Link>
                )}
                <Link href="/admin" className="btn btn-secondary !bg-transparent !text-mast-ink !border-[var(--mast-line)] hover:!bg-[rgb(255_255_255/0.08)]">
                  Manage tracked repositories
                </Link>
              </div>
            </div>
            {latest ? (
              <LatestCard d={latest} />
            ) : (
              <div className="rounded-2xl border border-[var(--mast-line)] p-6 text-mast-ink-2 enter" style={I(4)}>
                <p className="font-display text-3xl text-mast-ink">No digest yet</p>
                <p className="mt-2">The first one arrives on Monday at 09:00 India time, or as soon as an admin sends one.</p>
              </div>
            )}
          </div>
        </div>
      </header>

      <section aria-labelledby="how" className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
        <p className="eyebrow text-brand">How it works</p>
        <h2 id="how" className="mt-2 font-display text-[2.4rem] leading-tight">
          Releases in. Evidence checked. Five minutes out.
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            { icon: <IconCheck size={18} />, t: "Releases only", b: "GitHub Releases from the past 7 days, plus tags for repos that never publish releases. No issues, pull requests, comments or commits." },
            { icon: <IconShield size={18} />, t: "Evidence before urgency", b: "A security or breaking flag needs a quoted line from the notes, a GitHub advisory, or a major version bump. The AI cannot raise one alone." },
            { icon: <IconSparkle size={18} />, t: "Summarized, then ordered", b: "Gemini Flash writes one line per release; rules sort Act now, Review and FYI by impact and group the rest by product area." },
          ].map((s, i) => (
            <li key={s.t} className="card lift spot p-5">
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">{s.icon}</span>
                <span className="font-display text-2xl text-ink-3 tabular">0{i + 1}</span>
              </span>
              <h3 className="mt-4 font-semibold text-lg">{s.t}</h3>
              <p className="mt-1.5 text-sm text-ink-2">{s.b}</p>
            </li>
          ))}
        </ol>
      </section>

      {candidates.length > 0 && (
        <section aria-labelledby="adopt" className="mx-auto max-w-6xl px-4 sm:px-6 pb-14">
          <div className="card lift spot grid items-center gap-6 p-5 sm:p-7 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="eyebrow text-brand">Adoption Check</p>
              <h2 id="adopt" className="mt-2 font-display text-[2.2rem] leading-tight">
                Before you adopt it
              </h2>
              <p className="mt-2 max-w-xl text-ink-2">
                {candidates.length} open-source candidates, re-checked every Monday from GitHub, OpenSSF Scorecard, OSV and package registries. Fixed rules set every score and verdict, and each one lists its reasons.
              </p>
              <Link href="/evaluate" className="btn btn-primary mt-5">
                Open the watchlist <IconArrowRight />
              </Link>
            </div>
            <ul className="grid grid-cols-3 gap-2.5" aria-label="Verdicts">
              {[
                { v: "healthy", l: "Healthy", c: "var(--ok)", icon: <IconCheck size={14} /> },
                { v: "watch", l: "Watch", c: "var(--review)", icon: <IconReview size={14} /> },
                { v: "risky", l: "Risky", c: "var(--act)", icon: <IconAlert size={14} /> },
              ].map((t) => (
                <li key={t.v} className="rounded-xl border border-line bg-surface-2 px-2 py-4 text-center">
                  <p className="font-display text-[2.6rem] leading-none tabular" style={{ color: verdictCount(t.v) ? t.c : "var(--ink-3)" }} data-count>
                    {verdictCount(t.v)}
                  </p>
                  <p className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-ink-2">
                    <span style={{ color: t.c }}>{t.icon}</span>
                    {t.l}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {weeks.length > 0 && (
        <section aria-labelledby="recent" className="mx-auto max-w-6xl px-4 sm:px-6 pb-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">History</p>
              <h2 id="recent" className="mt-2 font-display text-[2rem] leading-tight">
                Recent weeks
              </h2>
            </div>
            <Link href="/archive" className="inline-flex items-center gap-1 font-semibold">
              Full archive <IconArrowRight />
            </Link>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {weeks.map((w) => (
              <li key={w.isoWeek}>
                <Link href={`/digest/${w.isoWeek}`} className="card lift spot block p-4 no-underline text-ink">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">Week of {fmtWeekOf(w.weekOf)}</span>
                    <span className="text-xs text-ink-3 tabular">{w.isoWeek}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-3 tabular">{fmtWindow(w.windowStart, w.windowEnd, "UTC")}</p>
                  <WeekBar counts={w.counts} className="mt-3" />
                  <div className="mt-3">
                    <CountRow counts={w.counts} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {latest && latest.coverage.length > 0 && (
        <section aria-label="Tracked areas" className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
          <div className="card p-5 sm:p-6 flex flex-wrap items-center gap-x-8 gap-y-4">
            <p className="font-semibold">Tracking {latest.counts.reposChecked} repositories across</p>
            <ul className="flex flex-wrap gap-2">
              {latest.coverage.map((c) => (
                <li key={c.category} className="chip !min-h-8 !px-3">
                  <span className="capitalize">{c.category}</span>
                  <span className="text-ink-3 tabular">{c.reposChecked}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
