import Link from "next/link";
import { AdvisoryCard, FlagChips, Monogram, ReleaseCard } from "@/components/digest/release-card";
import { IconAlert, IconCheck, IconExternal, IconInfo, IconLayers, IconReview, IconSparkle, PulseLine } from "@/components/icons";
import type { DigestModel } from "@/lib/digest/model";
import { fmtDateTime, fmtShortDate, fmtWeekOf, fmtWindow } from "@/lib/digest/format";
import { safeGithubUrl } from "@/lib/util";

/** Rough reading time: flagged cards take ~30s each, FYI lines ~6s. */
function readingMinutes(d: DigestModel): number {
  return Math.max(1, Math.round((d.act.length + d.advisories.length + d.review.length + d.updated.length) * 0.5 + d.counts.fyi * 0.1 + 0.5));
}

function glowFor(d: DigestModel): string {
  if (d.counts.act > 0) return "rgb(255 143 132 / 0.26)";
  if (d.counts.review > 0) return "rgb(246 200 110 / 0.22)";
  return "rgb(127 220 174 / 0.20)";
}

/** The four counts as tiles on the dark masthead. */
export function SummaryBar({ d, linkSections = true }: { d: DigestModel; linkSections?: boolean }) {
  const total = Math.max(1, d.counts.act + d.counts.review + d.counts.fyi);
  const cells = [
    { n: d.counts.act, label: "Act now", href: "#act-now", color: "var(--mast-act)", icon: <IconAlert size={14} />, share: d.counts.act / total },
    { n: d.counts.review, label: "Review", href: "#review", color: "var(--mast-review)", icon: <IconReview size={14} />, share: d.counts.review / total },
    { n: d.counts.fyi, label: "FYI", href: "#fyi", color: "var(--mast-ink)", icon: <IconInfo size={14} />, share: d.counts.fyi / total },
    { n: d.counts.couldNotCheck, label: "Could not check", href: "#could-not-check", color: "var(--mast-ink-2)", icon: null, share: d.counts.couldNotCheck / Math.max(1, d.counts.reposChecked) },
  ];
  return (
    <section aria-label="Summary" className="print-avoid-break">
      <ul className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3" data-testid="summary-bar">
        {cells.map((c) => {
          const body = (
            <>
              <span className="stat-num block" style={{ color: c.n > 0 ? c.color : "var(--mast-ink-2)" }}>
                {c.n}
              </span>
              <span className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-mast-ink">
                {c.icon}
                {c.label}
              </span>
              <span className="meter mt-3 block" aria-hidden="true">
                <span style={{ width: `${Math.round(c.share * 100)}%`, background: c.n > 0 ? c.color : "transparent" }} />
              </span>
            </>
          );
          return (
            <li key={c.label}>
              {linkSections && c.n > 0 ? (
                <a href={c.href} className="stat-tile">
                  {body}
                </a>
              ) : (
                <div className="stat-tile">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StatusLine({ d }: { d: DigestModel }) {
  return (
    <p className="mt-3 text-lg sm:text-xl text-mast-ink-2 measure" data-testid="status-line">
      <span style={{ color: d.counts.act ? "var(--mast-act)" : undefined }} className="font-semibold">
        {d.counts.act} need action
      </span>
      ,{" "}
      <span style={{ color: d.counts.review ? "var(--mast-review)" : undefined }} className="font-semibold">
        {d.counts.review} need review
      </span>
      , {d.counts.fyi} FYI
      {d.counts.couldNotCheck > 0 ? `, ${d.counts.couldNotCheck} ${d.counts.couldNotCheck === 1 ? "repo" : "repos"} could not be checked` : ""}.
    </p>
  );
}

export function Masthead({ d, toolbar }: { d: DigestModel; toolbar?: React.ReactNode }) {
  return (
    <header className="masthead" style={{ ["--mast-glow" as string]: glowFor(d) }}>
      <PulseLine className="pulse-line" />
      <div className="relative mx-auto max-w-[60rem] px-4 sm:px-6 pb-16">
        {toolbar}
        <p className="pt-6 sm:pt-8 text-xs font-semibold uppercase tracking-[0.14em] text-mast-ink-2 tabular enter" style={{ ["--i" as string]: 0 }}>
          Weekly release digest · {d.isoWeek} · {fmtWindow(d.window.start, d.window.end, d.timezoneLabel)}
        </p>
        <h1 className="mt-3 font-display text-[2.6rem] sm:text-[4rem] leading-[1.02] text-mast-ink enter-soft" style={{ ["--i" as string]: 1 }}>
          <span className="block font-sans text-base sm:text-lg font-semibold tracking-normal text-mast-ink-2">Upstream Weekly,</span>
          week of {fmtWeekOf(d.weekOf)}
        </h1>
        <div className="enter-soft" style={{ ["--i" as string]: 2 }}>
          <StatusLine d={d} />
        </div>
        <div className="mt-7 enter" style={{ ["--i" as string]: 3 }}>
          <SummaryBar d={d} />
        </div>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mast-ink-2 tabular enter" style={{ ["--i" as string]: 4 }}>
          <span>{d.counts.reposChecked} repos checked</span>
          <span aria-hidden="true">·</span>
          <span>{d.counts.releasesFound} releases</span>
          <span aria-hidden="true">·</span>
          <span>
            Last run {fmtDateTime(d.generatedAt, d.timezoneLabel)} ({d.timezoneLabel})
          </span>
          <span aria-hidden="true">·</span>
          <span>~{readingMinutes(d)} min read</span>
        </p>
      </div>
    </header>
  );
}

function SectionNav({ d }: { d: DigestModel }) {
  const items = [
    { href: "#act-now", label: "Act now", n: d.counts.act, tone: "text-act" },
    { href: "#review", label: "Review", n: d.counts.review, tone: "text-review" },
    ...(d.updated.length ? [{ href: "#updated", label: "Updated", n: d.updated.length, tone: "" }] : []),
    { href: "#fyi", label: "FYI", n: d.counts.fyi, tone: "" },
    ...(d.couldNotCheck.length ? [{ href: "#could-not-check", label: "Could not check", n: d.couldNotCheck.length, tone: "" }] : []),
    { href: "#coverage", label: "Coverage", n: null, tone: "" },
  ];
  return (
    <nav aria-label="Digest sections" className="section-nav sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur no-print">
      <div className="mx-auto flex max-w-[60rem] gap-1 overflow-x-auto px-3 sm:px-5 py-2">
        {items.map((i) => (
          <a key={i.href} href={i.href}>
            <span className={i.n ? i.tone : ""}>{i.label}</span>
            {i.n !== null && <span className="count-badge">{i.n}</span>}
          </a>
        ))}
      </div>
    </nav>
  );
}

function SectionHeading({ id, eyebrow, title, intro, icon, tone }: { id: string; eyebrow: string; title: string; intro: string; icon?: React.ReactNode; tone?: string }) {
  return (
    <div className="mb-5 keep-next">
      <p className={`eyebrow flex items-center gap-1.5 ${tone ?? ""}`}>
        {icon}
        {eyebrow}
      </p>
      <h2 id={id} className="mt-1 font-display text-[2rem] leading-tight scroll-mt-20">
        {title}
      </h2>
      <p className="mt-1 text-sm text-ink-3 measure">{intro}</p>
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="card flex items-center gap-3 p-4 text-ink-2">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-ok-bg text-ok">
        <IconCheck />
      </span>
      {children}
    </p>
  );
}

export function DigestView({ d, previewNote, toolbar }: { d: DigestModel; previewNote?: React.ReactNode; toolbar?: React.ReactNode }) {
  const tz = d.timezoneLabel;
  const quietWeek = d.counts.releasesFound === 0 && d.advisories.length === 0;
  const maxCov = Math.max(1, ...d.coverage.map((c) => c.releases));
  return (
    <article data-testid="digest">
      <Masthead d={d} toolbar={toolbar} />
      <SectionNav d={d} />
      <div className="mx-auto max-w-[50rem] px-4 sm:px-6">
        {previewNote}

        <section aria-labelledby="glance" className="glance mt-8 p-5 sm:p-6 lift">
          <h2 id="glance" className="eyebrow flex items-center gap-1.5 text-brand">
            <IconSparkle /> This week at a glance
          </h2>
          <p className="mt-3 text-[1.125rem] leading-relaxed measure text-ink">{d.synthesis.paragraph}</p>
          {d.synthesis.actions.length > 0 && (
            <ol className="mt-4 space-y-2.5" aria-label="Suggested actions">
              {d.synthesis.actions.map((a, i) => (
                <li key={i} className="check-item text-ink-2 measure">
                  <span className="check-box tabular" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>{a}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-xs text-ink-3">
            {d.synthesis.source === "ai" ? "Written by Gemini Flash using only the items below, and checked for invented versions or IDs." : "Generated from the counts and flagged items below."}
          </p>
        </section>

        {quietWeek ? (
          <section aria-labelledby="all-quiet" className="mt-10 card lift p-6 sm:p-8 text-center print-avoid-break" data-testid="all-quiet">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok-bg text-ok">
              <IconCheck size={26} />
            </span>
            <h2 id="all-quiet" className="mt-4 font-display text-[2rem]">
              All quiet this week
            </h2>
            <p className="mx-auto mt-2 text-ink-2 measure">
              Every tracked repository was checked for releases published between {fmtWindow(d.window.start, d.window.end, tz)}. None shipped anything, so there is nothing to upgrade or review.
            </p>
            {d.quiet.length > 0 && (
              <ul className="mt-5 flex flex-wrap justify-center gap-1.5" aria-label="Repositories checked">
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
            <section aria-labelledby="act-now" className="mt-12">
              <SectionHeading id="act-now" eyebrow="Tier 1" title="Act now" intro="Security fixes and urgent upgrades. Check the quoted evidence, then act." icon={<IconAlert size={13} />} tone="text-act" />
              {d.act.length === 0 && d.advisories.length === 0 ? (
                <EmptyLine>Nothing needs action this week.</EmptyLine>
              ) : (
                <div className="space-y-4">
                  {d.act.map((i) => (
                    <ReleaseCard key={i.id} item={i} tone="act" tz={tz} />
                  ))}
                  {d.advisories.map((a) => (
                    <AdvisoryCard key={a.ghsaId} a={a} />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="review" className="mt-14">
              <SectionHeading id="review" eyebrow="Tier 2" title="Review" intro="Breaking changes, major version bumps, and items worth a closer look before your next upgrade." icon={<IconReview size={13} />} tone="text-review" />
              {d.review.length === 0 ? (
                <EmptyLine>Nothing to review this week.</EmptyLine>
              ) : (
                <div className="space-y-4">
                  {d.review.map((i) => (
                    <ReleaseCard key={i.id} item={i} tone="review" tz={tz} />
                  ))}
                </div>
              )}
            </section>

            {d.updated.length > 0 && (
              <section aria-labelledby="updated" className="mt-14">
                <SectionHeading id="updated" eyebrow="Revised" title="Updated since last digest" intro="Already reported in an earlier digest. Their release notes have changed since." />
                <div className="space-y-4">
                  {d.updated.map((i) => (
                    <ReleaseCard key={i.id} item={i} tone="updated" tz={tz} />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="fyi" className="mt-14">
              <SectionHeading id="fyi" eyebrow="Tier 3" title="FYI" intro="Everything else that shipped, grouped by the part of the product it touches." icon={<IconInfo size={13} />} />
              {d.fyi.length === 0 ? (
                <p className="card p-4 text-ink-2">No other releases this week.</p>
              ) : (
                <div className="space-y-6">
                  {d.fyi.map((g) => (
                    <div key={g.category} className="card lift overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 card-head-neutral">
                        <h3 className="flex items-center gap-2 font-semibold capitalize">
                          <IconLayers className="text-ink-3" />
                          {g.category}
                        </h3>
                        <span className="text-xs text-ink-3 tabular">
                          {g.coverage.reposChecked} {g.coverage.reposChecked === 1 ? "repo" : "repos"} checked · {g.coverage.releases} {g.coverage.releases === 1 ? "release" : "releases"}
                        </span>
                      </div>
                      <ul className="divide-y divide-line">
                        {g.items.map((i) => {
                          const url = safeGithubUrl(i.url);
                          return (
                            <li key={i.id} className="flex gap-3 px-4 sm:px-5 py-3.5 print-avoid-break" data-testid="fyi-item">
                              <Monogram repo={i.repo} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <p className="font-semibold break-all">{i.repo}</p>
                                  <span className="version-pill">{i.tag}</span>
                                  <time dateTime={i.publishedAt} className="ml-auto tabular text-xs text-ink-3">
                                    {fmtShortDate(i.publishedAt, tz)}
                                  </time>
                                </div>
                                {(i.flags.prerelease || i.flags.tagOnly || i.flags.lowConfidence) && (
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    <FlagChips item={i} />
                                  </div>
                                )}
                                <p className="mt-1.5 text-sm text-ink-2 measure">
                                  {i.summary}
                                  {i.alsoIn.length > 0 && <span className="text-ink-3"> Also in {i.alsoIn.join(", ")}.</span>}{" "}
                                  {url && (
                                    <a href={url} rel="noopener noreferrer" target="_blank" className="whitespace-nowrap font-medium">
                                      Notes<span className="sr-only"> for {i.repo} {i.tag} (opens in a new tab)</span> <IconExternal className="inline" size={12} />
                                    </a>
                                  )}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                        {g.earlier.map((e) => (
                          <li key={e.repo} className="px-4 sm:px-5 py-2.5 text-sm text-ink-3">
                            <details>
                              <summary className="disclosure-summary !min-h-9 !text-ink-2 !font-medium">
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
          <section aria-labelledby="could-not-check" className="mt-14">
            <SectionHeading id="could-not-check" eyebrow="Coverage gap" title="Could not check" intro="These repositories were skipped this week. Every other repository was checked." />
            <ul className="card divide-y divide-line">
              {d.couldNotCheck.map((c) => (
                <li key={c.repo} className="flex gap-3 p-4 text-sm">
                  <Monogram repo={c.repo} />
                  <span>
                    <span className="font-semibold">{c.repo}</span>
                    <span className="block text-ink-2">{c.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="coverage" className="mt-14">
          <SectionHeading id="coverage" eyebrow="Coverage" title="What was checked" intro="Every enabled repository, by the part of the product it belongs to." />
          <div className="card lift p-4 sm:p-5">
            <ul className="space-y-3">
              {d.coverage.map((c) => (
                <li key={c.category} className="grid grid-cols-[7rem_1fr_auto] sm:grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="capitalize font-medium">{c.category}</span>
                  <span className="bar-track" aria-hidden="true">
                    <span style={{ width: `${Math.max(c.releases ? 6 : 0, Math.round((c.releases / maxCov) * 100))}%`, background: "var(--brand)" }} />
                  </span>
                  <span className="tabular text-ink-3 whitespace-nowrap">
                    {c.releases} rel. · {c.reposChecked} repos
                  </span>
                </li>
              ))}
            </ul>
            {!quietWeek && d.quiet.length > 0 && (
              <div className="mt-5 border-t border-line pt-4" data-testid="quiet-repos">
                <p className="text-sm font-semibold text-ink-2">Checked, no releases this week</p>
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Quiet repositories">
                  {d.quiet.map((r) => (
                    <li key={r} className="chip">
                      <IconCheck size={11} className="text-ok" /> {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.alreadyReported.length > 0 && (
              <p className="mt-2 text-sm text-ink-3">
                <span className="font-semibold text-ink-2">Already covered in an earlier digest: </span>
                {d.alreadyReported.map((a) => `${a.repo} ${a.tag}`).join(", ")}.
              </p>
            )}
          </div>
        </section>

        <footer className="mt-12 rounded-2xl border border-line bg-surface-2 p-5 text-sm text-ink-3 space-y-1.5">
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
      </div>
    </article>
  );
}
