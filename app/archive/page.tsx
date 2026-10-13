import type { Metadata } from "next";
import Link from "next/link";
import { CountRow } from "@/components/digest/count-row";
import { WeekBar } from "@/components/digest/week-bar";
import { IconArrowRight } from "@/components/icons";
import { PageMasthead } from "@/components/page-masthead";
import { fmtWeekOf, fmtWindow } from "@/lib/digest/format";
import { listDigests } from "@/lib/digest/queries";
import { timezoneLabel } from "@/lib/env";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Archive",
  description: "Every weekly Upstream Weekly digest, with its action, review and FYI counts.",
  alternates: { canonical: "/archive" },
  openGraph: { title: "Upstream Weekly · Archive", description: "Every weekly digest with its counts." },
};

export default async function ArchivePage() {
  const tz = timezoneLabel();
  let entries: Awaited<ReturnType<typeof listDigests>> = [];
  let failed = false;
  try {
    entries = await listDigests();
  } catch {
    failed = true;
  }
  return (
    <main id="main">
      <PageMasthead
        maxW="max-w-4xl"
        eyebrow="Archive"
        title="Past digests"
        lede="One digest per ISO week, newest first. The bar on each week shows how much of it needed action (red) or review (amber)."
        aside={
          entries.length > 0 ? (
            <dl className="grid grid-cols-3 gap-2.5">
              {[
                { k: "Weeks", v: entries.length, c: "var(--mast-ink)" },
                { k: "Releases", v: entries.reduce((n, e) => n + e.counts.releasesFound, 0), c: "var(--mast-ink)" },
                { k: "Acted on", v: entries.reduce((n, e) => n + e.counts.act, 0), c: "var(--mast-act)" },
              ].map((x) => (
                <div key={x.k} className="stat-tile !min-h-0 !flex flex-col-reverse justify-end">
                  {/* dt must come first in a definition list; flex-col-reverse puts the number on top. */}
                  <dt className="mt-1.5 text-sm font-semibold text-mast-ink">{x.k}</dt>
                  <dd className="stat-num !text-[2.6rem]" style={{ color: x.v ? x.c : "var(--mast-ink-2)" }}>
                    {x.v}
                  </dd>
                </div>
              ))}
            </dl>
          ) : undefined
        }
      />

      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8">
      {failed ? (
        <div className="card mt-8 p-5" role="alert">
          <h2 className="font-semibold">The archive could not be loaded</h2>
          <p className="mt-1 text-ink-2">The database did not respond. Reload the page to try again.</p>
          <Link href="/archive" className="btn btn-secondary mt-4">
            Retry
          </Link>
        </div>
      ) : entries.length === 0 ? (
        <div className="card mt-8 p-5">
          <h2 className="font-semibold">No digests yet</h2>
          <p className="mt-1 text-ink-2 measure">The first digest is published on Monday at 09:00 India time, or as soon as an admin sends one from the admin page.</p>
          <Link href="/admin" className="btn btn-secondary mt-4">
            Go to admin
          </Link>
        </div>
      ) : (
        <ol className="mt-8 relative border-l border-line ml-2" data-testid="archive-list">
          {entries.map((e) => (
            <li key={e.isoWeek} className="relative pl-6 pb-6 last:pb-0">
              <span
                aria-hidden="true"
                className={`absolute -left-[7px] top-2 h-3 w-3 rounded-full border-2 border-bg ${e.counts.act > 0 ? "bg-act" : e.counts.review > 0 ? "bg-review" : "bg-line-strong"}`}
              />
              <Link href={`/digest/${e.isoWeek}`} className="card lift block p-4 sm:p-5 no-underline text-ink">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h2 className="font-display text-2xl">Week of {fmtWeekOf(e.weekOf)}</h2>
                  <span className="text-sm text-ink-3 tabular">{e.isoWeek}</span>
                </div>
                <p className="mt-0.5 text-sm text-ink-3 tabular">
                  {fmtWindow(e.windowStart, e.windowEnd, tz)} · {e.counts.releasesFound} releases across {e.counts.reposChecked} repos
                  {e.delivered ? "" : " · not emailed"}
                </p>
                <WeekBar counts={e.counts} className="mt-3" />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <CountRow counts={e.counts} />
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
                    Open <IconArrowRight />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
      </div>
    </main>
  );
}
