import Link from "next/link";
import { SummaryBar } from "@/components/digest/digest-view";
import { fmtWeekOf } from "@/lib/digest/format";
import { getLatestDigest } from "@/lib/digest/queries";

export const revalidate = 300;

export default async function Home() {
  const latest = await getLatestDigest().catch(() => null);
  return (
    <main id="main" className="mx-auto max-w-[46rem] px-4 sm:px-6 pt-10">
      {latest ? (
        <>
          <p className="eyebrow">Latest digest · {latest.isoWeek}</p>
          <h1 className="mt-2 text-[1.75rem] sm:text-[2.25rem] leading-tight font-semibold tracking-[-0.015em]">Week of {fmtWeekOf(latest.weekOf)}</h1>
          <p className="mt-2 text-ink-2">{latest.statusLine}.</p>
          <div className="mt-6">
            <SummaryBar d={latest} linkSections={false} />
          </div>
          <p className="mt-4 text-ink-2 measure">{latest.synthesis.paragraph}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/digest/${latest.isoWeek}`} className="btn btn-primary">
              Read this week&apos;s digest
            </Link>
            <Link href="/archive" className="btn btn-secondary">
              Browse past weeks
            </Link>
          </div>
        </>
      ) : (
        <Explainer />
      )}
      <section aria-labelledby="how" className="mt-14 border-t border-line pt-8">
        <h2 id="how" className="text-lg font-semibold">
          How the digest works
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3 text-sm">
          <div>
            <dt className="font-semibold">Releases only</dt>
            <dd className="mt-1 text-ink-2">GitHub Releases from the past 7 days, plus tags for repos that never publish releases. No issues, pull requests, comments or commits.</dd>
          </div>
          <div>
            <dt className="font-semibold">Evidence before urgency</dt>
            <dd className="mt-1 text-ink-2">A security or breaking flag needs a quoted phrase from the notes, a GitHub advisory, or a major version bump.</dd>
          </div>
          <div>
            <dt className="font-semibold">Every Monday</dt>
            <dd className="mt-1 text-ink-2">Emailed at 09:00 India time and published here, even in quiet weeks, so you know every repo was checked.</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

function Explainer() {
  return (
    <>
      <p className="eyebrow">Weekly release digest</p>
      <h1 className="mt-2 text-[1.75rem] sm:text-[2.25rem] leading-tight font-semibold tracking-[-0.015em]">The releases that matter, every Monday, in five minutes.</h1>
      <p className="mt-3 text-ink-2 measure">
        Dependency Pulse reads new releases across the open-source libraries your product depends on. It puts security fixes and breaking changes at the top with the evidence quoted, and summarizes everything else in a line.
      </p>
      <p className="mt-3 text-ink-2 measure">No digest has been published yet. The first one arrives on Monday at 09:00 India time.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/archive" className="btn btn-primary">
          Open the archive
        </Link>
        <Link href="/admin" className="btn btn-secondary">
          Manage tracked repositories
        </Link>
      </div>
    </>
  );
}
