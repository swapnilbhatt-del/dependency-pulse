import Link from "next/link";
import { AdvisoryCard, FlagChips, ReleaseCard } from "@/components/digest/release-card";
import { IconAlert, IconCheck, IconExternal, IconInfo, IconReview } from "@/components/icons";
import type { DigestModel } from "@/lib/digest/model";
import { fmtDateTime, fmtShortDate, fmtWeekOf, fmtWindow } from "@/lib/digest/format";
import { safeGithubUrl } from "@/lib/util";

export function SummaryBar({ d, linkSections = true }: { d: DigestModel; linkSections?: boolean }) {
  const cells = [
    { n: d.counts.act, label: "Act now", href: "#act-now", tone: "text-act", icon: <IconAlert size={14} /> },
    { n: d.counts.review, label: "Review", href: "#review", tone: "text-review", icon: <IconReview size={14} /> },
    { n: d.counts.fyi, label: "FYI", href: "#fyi", tone: "text-ink", icon: <IconInfo size={14} /> },
    { n: d.counts.couldNotCheck, label: "Could not check", href: "#could-not-check", tone: "text-ink-2", icon: null },
  ];
  return (
    <section aria-label="Summary" className="print-avoid-break">
      <ul className="grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-[10px] border border-line bg-line" data-testid="summary-bar">
        {cells.map((c) => {
          const body = (
            <>
              <span className={`block text-[2.5rem] leading-none font-semibold tabular ${c.n > 0 ? c.tone : "text-ink-3"}`}>{c.n}</span>
              <span className="mt-2 flex items-center gap-1.5 text-sm font-medium text-ink-2">
                {c.icon}
                {c.label}
              </span>
            </>
          );
          return (
            <li key={c.label} className="bg-surface">
              {linkSections && c.n > 0 ? (
                <a href={c.href} className="block p-4 no-underline hover:bg-surface-2 transition-colors min-h-[96px]">
                  {body}
                </a>
              ) : (
                <div className="p-4 min-h-[96px]">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm text-ink-3 tabular">
        Window {fmtWindow(d.window.start, d.window.end, d.timezoneLabel)} · last run {fmtDateTime(d.generatedAt, d.timezoneLabel)} ({d.timezoneLabel})
      </p>
    </section>
  );
}

function SectionHeading({ id, eyebrow, title, intro, icon, tone }: { id: string; eyebrow: string; title: string; intro: string; icon?: React.ReactNode; tone?: string }) {
  return (
    <div className="mb-4">
      <p className={`eyebrow flex items-center gap-1.5 ${tone ?? ""}`}>
        {icon}
        {eyebrow}
      </p>
      <h2 id={id} className="mt-1 text-xl font-semibold tracking-tight scroll-mt-20">
        {title}
      </h2>
      <p className="mt-1 text-sm text-ink-3 measure">{intro}</p>
    </div>
  );
}

export function DigestView({ d, previewNote }: { d: DigestModel; previewNote?: React.ReactNode }) {
  const tz = d.timezoneLabel;
  const quietWeek = d.counts.releasesFound === 0 && d.advisories.length === 0;
  return (
    <article className="mx-auto max-w-[46rem] px-4 sm:px-6" data-testid="digest">
      {previewNote}
      <header className="pt-8 sm:pt-10">
        <p className="eyebrow">Weekly release digest · {d.isoWeek}</p>
        <h1 className="mt-2 text-[1.75rem] sm:text-[2.25rem] leading-[1.15] font-semibold tracking-[-0.015em]">Dependency Pulse, week of {fmtWeekOf(d.weekOf)}</h1>
        <p className="mt-2 text-ink-2" data-testid="status-line">
          {d.statusLine}.
        </p>
      </header>

      <div className="mt-6">
        <SummaryBar d={d} />
      </div>

      <section aria-labelledby="glance" className="card mt-6 p-4 sm:p-5 print-avoid-break">
        <h2 id="glance" className="eyebrow">
          This week at a glance
        </h2>
        <p className="mt-2 text-[1.0625rem] leading-relaxed measure">{d.synthesis.paragraph}</p>
        {d.synthesis.actions.length > 0 && (
          <ol className="mt-3 list-decimal pl-5 space-y-1 text-ink-2 measure">
            {d.synthesis.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-ink-3">
          {d.synthesis.source === "ai" ? "Written by Gemini Flash using only the items below, and checked for invented versions or IDs." : "Generated from the counts and flagged items below."}
        </p>
      </section>

      {quietWeek ? (
        <section aria-labelledby="all-quiet" className="mt-10 card p-5 sm:p-6 print-avoid-break" data-testid="all-quiet">
          <p className="eyebrow flex items-center gap-1.5 text-ok">
            <IconCheck /> All quiet
          </p>
          <h2 id="all-quiet" className="mt-1 text-xl font-semibold">
            No new releases this week
          </h2>
          <p className="mt-2 text-ink-2 measure">
            Every tracked repository was checked for releases published between {fmtWindow(d.window.start, d.window.end, tz)}. None shipped anything, so there is nothing to upgrade or review.
          </p>
          {d.quiet.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Repositories checked">
              {d.quiet.map((r) => (
                <li key={r} className="chip">
                  <IconCheck size={11} /> {r}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="act-now" className="mt-10">
            <SectionHeading id="act-now" eyebrow="Tier 1" title="Act now" intro="Security fixes and urgent upgrades. Check the quoted evidence, then act." icon={<IconAlert size={13} />} tone="text-act" />
            {d.act.length === 0 && d.advisories.length === 0 ? (
              <p className="card p-4 text-ink-2 flex items-center gap-2">
                <IconCheck className="text-ok" /> Nothing needs action this week.
              </p>
            ) : (
              <div className="space-y-3">
                {d.act.map((i) => (
                  <ReleaseCard key={i.id} item={i} tone="act" tz={tz} />
                ))}
                {d.advisories.map((a) => (
                  <AdvisoryCard key={a.ghsaId} a={a} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="review" className="mt-10">
            <SectionHeading id="review" eyebrow="Tier 2" title="Review" intro="Breaking changes, major version bumps, and items worth a closer look before your next upgrade." icon={<IconReview size={13} />} tone="text-review" />
            {d.review.length === 0 ? (
              <p className="card p-4 text-ink-2 flex items-center gap-2">
                <IconCheck className="text-ok" /> Nothing to review this week.
              </p>
            ) : (
              <div className="space-y-3">
                {d.review.map((i) => (
                  <ReleaseCard key={i.id} item={i} tone="review" tz={tz} />
                ))}
              </div>
            )}
          </section>

          {d.updated.length > 0 && (
            <section aria-labelledby="updated" className="mt-10">
              <SectionHeading id="updated" eyebrow="Revised" title="Updated since last digest" intro="Already reported in an earlier digest. Their release notes have changed since." />
              <div className="space-y-3">
                {d.updated.map((i) => (
                  <ReleaseCard key={i.id} item={i} tone="updated" tz={tz} />
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="fyi" className="mt-10">
            <SectionHeading id="fyi" eyebrow="Tier 3" title="FYI" intro="Everything else that shipped, grouped by the part of the product it touches." icon={<IconInfo size={13} />} />
            {d.fyi.length === 0 ? (
              <p className="card p-4 text-ink-2">No other releases this week.</p>
            ) : (
              <div className="space-y-6">
                {d.fyi.map((g) => (
                  <div key={g.category}>
                    <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold capitalize">
                      {g.category}
                      <span className="text-sm font-normal normal-case text-ink-3 tabular">
                        {g.coverage.reposChecked} {g.coverage.reposChecked === 1 ? "repo" : "repos"} checked, {g.coverage.releases} {g.coverage.releases === 1 ? "release" : "releases"}
                      </span>
                    </h3>
                    <ul className="mt-2 card divide-y divide-line">
                      {g.items.map((i) => {
                        const url = safeGithubUrl(i.url);
                        return (
                          <li key={i.id} className="p-3 sm:px-4 print-avoid-break" data-testid="fyi-item">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <p className="font-semibold">
                                {i.repo} <span className="font-mono text-[0.95em] font-medium">{i.tag}</span>
                              </p>
                              <time dateTime={i.publishedAt} className="tabular text-sm text-ink-3">
                                {fmtShortDate(i.publishedAt, tz)}
                              </time>
                            </div>
                            {(i.flags.prerelease || i.flags.tagOnly || i.flags.lowConfidence) && (
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <FlagChips item={i} />
                              </div>
                            )}
                            <p className="mt-1 text-sm text-ink-2 measure">
                              {i.summary}
                              {i.alsoIn.length > 0 && <span className="text-ink-3"> Also in {i.alsoIn.join(", ")}.</span>}{" "}
                              {url && (
                                <a href={url} rel="noopener noreferrer" target="_blank" className="whitespace-nowrap">
                                  Notes<span className="sr-only"> for {i.repo} {i.tag} (opens in a new tab)</span> <IconExternal className="inline" size={12} />
                                </a>
                              )}
                            </p>
                          </li>
                        );
                      })}
                      {g.earlier.map((e) => (
                        <li key={e.repo} className="p-3 sm:px-4 text-sm text-ink-3">
                          <details>
                            <summary className="disclosure-summary !min-h-0 !text-ink-2 !font-medium">
                              +{e.tags.length} earlier {e.tags.length === 1 ? "release" : "releases"} of {e.repo}
                            </summary>
                            <p className="disclosure-body mt-1 font-mono text-xs leading-relaxed">{e.tags.join(", ")}</p>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {d.couldNotCheck.length > 0 && (
        <section aria-labelledby="could-not-check" className="mt-10">
          <SectionHeading id="could-not-check" eyebrow="Coverage gap" title="Could not check" intro="These repositories were skipped this week. Every other repository was checked." />
          <ul className="card divide-y divide-line">
            {d.couldNotCheck.map((c) => (
              <li key={c.repo} className="p-3 sm:px-4 text-sm">
                <span className="font-semibold">{c.repo}</span>
                <span className="text-ink-2">: {c.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!quietWeek && d.quiet.length > 0 && (
        <p className="mt-8 text-sm text-ink-3 measure" data-testid="quiet-repos">
          <span className="font-semibold text-ink-2">Checked, no releases: </span>
          {d.quiet.join(", ")}.
        </p>
      )}
      {d.alreadyReported.length > 0 && (
        <p className="mt-3 text-sm text-ink-3 measure">
          <span className="font-semibold text-ink-2">Already covered in an earlier digest: </span>
          {d.alreadyReported.map((a) => `${a.repo} ${a.tag}`).join(", ")}.
        </p>
      )}

      <section aria-label="Coverage by category" className="mt-8">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3 tabular">
          {d.coverage.map((c) => (
            <li key={c.category}>
              <span className="capitalize">{c.category}</span>: {c.reposChecked} checked, {c.releases} {c.releases === 1 ? "release" : "releases"}
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-8 border-t border-line pt-4 text-sm text-ink-3 space-y-1">
        <p className="tabular">
          {d.counts.reposChecked} repos checked · {d.counts.releasesFound} releases found · {d.counts.aiFallbacks} AI {d.counts.aiFallbacks === 1 ? "fallback" : "fallbacks"} · run {fmtDateTime(d.generatedAt, tz)} ({tz})
        </p>
        {d.notices.map((n, i) => (
          <p key={i} className="text-review">
            {n}
          </p>
        ))}
        <p>
          Summaries are written by Gemini Flash from each release&apos;s notes and checked against them. A flag needs a quoted phrase from the notes, a GitHub advisory, or a major version bump.
        </p>
        <p className="no-print flex gap-4 pt-1">
          <Link href="/archive">All digests</Link>
          <Link href="/admin">Manage repositories</Link>
        </p>
      </footer>
    </article>
  );
}
