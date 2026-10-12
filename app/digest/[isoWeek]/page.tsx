import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DigestView } from "@/components/digest/digest-view";
import { PrintButton } from "@/components/print-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { fmtWeekOf } from "@/lib/digest/format";
import { getDigestModel } from "@/lib/digest/queries";
import { ISO_WEEK_PATTERN } from "@/lib/filter/window";

export const revalidate = 300;

/** No weeks are prerendered at build time; each is rendered on first request and cached (ISR). */
export function generateStaticParams(): { isoWeek: string }[] {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/digest/[isoWeek]">): Promise<Metadata> {
  const { isoWeek } = await params;
  if (!ISO_WEEK_PATTERN.test(isoWeek)) return { title: "Digest not found" };
  const d = await getDigestModel(isoWeek).catch(() => null);
  if (!d) return { title: "Digest not found" };
  const title = `Week of ${fmtWeekOf(d.weekOf)}`;
  const description = `${d.statusLine}. ${d.counts.reposChecked} repositories checked.`;
  return {
    title,
    description,
    alternates: { canonical: `/digest/${isoWeek}` },
    openGraph: { title: `Dependency Pulse · ${title}`, description, type: "article", url: `/digest/${isoWeek}` },
  };
}

export default async function DigestPage({ params }: PageProps<"/digest/[isoWeek]">) {
  const { isoWeek } = await params;
  if (!ISO_WEEK_PATTERN.test(isoWeek)) notFound();
  const d = await getDigestModel(isoWeek);
  if (!d) notFound();
  return (
    <>
      <div className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur no-print">
        <div className="mx-auto flex h-12 max-w-[46rem] items-center justify-between px-4 sm:px-6">
          <Link href="/archive" className="text-sm font-semibold tabular no-underline text-ink min-h-11 inline-flex items-center">
            ← {d.isoWeek}
          </Link>
          <div className="flex items-center">
            <ThemeToggle />
            <PrintButton />
          </div>
        </div>
      </div>
      <main id="main">
        <DigestView d={d} />
      </main>
    </>
  );
}
